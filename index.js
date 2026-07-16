require('dotenv').config();
const axios = require('axios');
const { getLocationId, paginateProductsByVendor, updateInventory } = require('./shopifyFunctions');

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

function getStores() {
    const storeNames = process.env.STORES.split(',');

    return storeNames.map(name => ({
        name,
        graphqlUrl: process.env[`GRAPHQL_URL_${name}`],
        shopifyToken: process.env[`SHOPIFY_TOKEN_${name}`],
    }));
}

async function updateProducts(store, products) {
    const locationId = await getLocationId(store);
    const shopifyProducts = await paginateProductsByVendor(store, 'DKPS');
    const uniqueModels = [...new Set(products.map(p => p.sku.split('-')[0]))];
    for (const model of uniqueModels) {
        // if (model !== 'B000100') continue; // If para pruebas con un producto específico
        const activeVariants = products.filter(p => p.sku.startsWith(model));
        const product = activeVariants[0];
        try {
            const handle = `dk-${model}`.trim().toLowerCase();
            const shopifyProduct = shopifyProducts.find(p => p.handle === handle);
            if (!shopifyProduct) continue;

            const shopifyVariants = shopifyProduct.variants.nodes;
            const activeVariantBySKU = new Map(activeVariants.map(v => [v.sku, v]));
    
            for (const variant of shopifyVariants) {
                const activeVariant = activeVariantBySKU.get(variant.sku);
                const targetInventory = activeVariant ? activeVariant.existencias.reduce((acum, warehouse) => {
                    return warehouses.includes(warehouse.almacen) ? acum + warehouse.cantidad : acum;
                }, 0) : 0;
                const label = activeVariant ? 'Variante existente' : 'Variante faltante';
                console.log(`[${store.name}] ${label}: ${shopifyProduct.title} ${variant.title}, Prev ${variant.inventoryQuantity} Now ${targetInventory}`);

                if (variant.inventoryQuantity === targetInventory) continue;

                const variantToUpdate = {
                    quantities: {
                        changeFromQuantity: null,
                        inventoryItemId: variant.inventoryItem.id,
                        locationId,
                        quantity: targetInventory,
                    },
                    name: "available",
                    reason: "correction",
                };
                const response = await updateInventory(store, variantToUpdate);
                console.log(`[${store.name}] Inventario actualizado:`, response.changes);
            }
            // break;
        } catch (error) {
            console.error(`[${store.name}] Error actualizando ${model}:`, error);
        }
    }
}

async function main() {
    const products = await paginateDKPSInventory();

    const stores = getStores();
    for (const store of stores) {
        await updateProducts(store, products);
    }
}

main();
