require('dotenv').config();
const axios = require('axios');
const { getLocationId, getProductByHandle, updateInventory } = require('./shopifyFunctions');

const warehouses = [
    'ALMACEN GENERAL MÉXICO',
    'MATRIZ',
    'ALGARÍN 1',
    'ALGARÍN 2',
    'ALGARIN 3',
    'CORREO MAYOR',
];

async function getDKPSInventory(pagina) {
    const response = await axios.get(
        'https://bfekkcapbvnilicqzpkr.supabase.co/functions/v1/api-rest/api/productos/precios-existencias',
        {
            params: {
                pagina,
                limite: 100,
            },
            headers: {
                'Authorization': `Bearer ${process.env.DKPS_AUTH_TOKEN}`
            },
        }
    );

    return response.data;
}

async function paginateDKPSInventory() {
    const firstResponse = await getDKPSInventory(1);
    let products = firstResponse.data;
    const pages = firstResponse.pagination.totalPages;

    let page = 2;
    while (page <= pages) {
        const response = await getDKPSInventory(page);
        products = [...products, ...response.data];
        page++;
    }
    return products;
}

async function updateProducts() {
    const products = await paginateDKPSInventory();

    const locationId = await getLocationId();
    const uniqueModels = [...new Set(products.map(p => p.sku.split('-')[0]))];
    for (const model of uniqueModels) {
        // if (model !== 'B000100') continue; // If para pruebas con un producto específico
        const activeVariants = products.filter(p => p.sku.startsWith(model));
        const product = activeVariants[0];
        try {
            const handle = `dk-${model}`.trim().toLowerCase();
            const shopifyProduct = await getProductByHandle(handle);
            if (!shopifyProduct) {
                continue;
            }

            const shopifyVariants = shopifyProduct.variants.nodes;
            for (const activeVariant of activeVariants) {
                const variant = shopifyVariants.find(v => v.sku === activeVariant.sku);
                const variantInventory = activeVariant.existencias.reduce((acum, warehouse) => {
                    return warehouses.includes(warehouse.almacen) ? acum + warehouse.cantidad : acum;
                }, 0);
                console.log(`Variante encontrada: ${shopifyProduct.title} ${variant.title}, Inventario: Prev ${variant.inventoryQuantity} Now ${variantInventory}`);

                if (variant.inventoryQuantity !== variantInventory) {
                    const variantToUpdate = {
                        quantities: {
                            changeFromQuantity: null,
                            inventoryItemId: variant.inventoryItem.id,
                            locationId,
                            quantity: variantInventory,
                        },
                        name: "available",
                        reason: "correction",
                    };
                    const response = await updateInventory(variantToUpdate);
                    console.log('Inventario actualizado:', response.changes);
                }
            }
            // break;
        } catch (error) {
            console.error(`Error actualizando el producto ${model}:`, error);
        }
    }
}

updateProducts();