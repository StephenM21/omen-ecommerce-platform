/**
 * OMEN Store — Backend Server
 * Handles: Printful API proxy + Stripe Checkout
 *
 * HOW TO RUN:
 * 1. Make sure Node.js is installed (https://nodejs.org)
 * 2. In this folder, run: npm install
 * 3. Fill in your keys in .env (see .env.example)
 * 4. Run: node server.js
 * 5. Server starts at http://localhost:3001
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const app = express();
app.use(cors({ origin: '*' })); // Restrict to your domain in production

// ─── STRIPE WEBHOOK (must be before express.json()) ──────────────────────────
// Stripe requires the raw request body for signature verification
const PORT = process.env.PORT || 3001;

app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const shipping = session.shipping_details;
    const customer = session.customer_details;

    let cartItems = [];
    try {
      cartItems = JSON.parse(session.metadata?.cart || '[]');
    } catch (e) {
      console.error('Failed to parse cart metadata:', e.message);
    }

    const printfulItems = cartItems.filter(i => i.source === 'printful' && i.variantId);

    if (printfulItems.length > 0 && shipping?.address) {
      try {
        const orderRes = await fetch('https://api.printful.com/orders', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.PRINTFUL_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            recipient: {
              name: shipping.name || customer?.name || 'Customer',
              email: customer?.email || '',
              address1: shipping.address.line1,
              address2: shipping.address.line2 || '',
              city: shipping.address.city,
              state_code: shipping.address.state,
              country_code: shipping.address.country,
              zip: shipping.address.postal_code,
            },
            items: printfulItems.map(i => ({
              variant_id: i.variantId,
              quantity: i.qty,
            })),
          }),
        });
        const orderData = await orderRes.json();
        if (orderData.result) {
          console.log(`✅ Printful order created: #${orderData.result.id} for ${customer?.email}`);
        } else {
          console.error('Printful order error:', JSON.stringify(orderData));
        }
      } catch (err) {
        console.error('Printful fulfillment error:', err.message);
      }
    }

    const tapstitchItems = cartItems.filter(i => i.source === 'tapstitch');
    if (tapstitchItems.length > 0) {
      console.log(`📦 Tapstitch items to fulfill manually for ${customer?.email}:`);
      tapstitchItems.forEach(i => console.log(`  - ${i.name} / ${i.size} / ${i.color} x${i.qty}`));
    }
  }

  res.json({ received: true });
});

app.use(express.json());

// ─── PRINTFUL ────────────────────────────────────────────────────────────────
// GET /api/products — returns all synced products from your Printful store
app.get('/api/products', async (req, res) => {
  try {
    const response = await fetch('https://api.printful.com/sync/products', {
      headers: {
        Authorization: `Bearer ${process.env.PRINTFUL_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Printful error: ${response.status}`);
    }

    const data = await response.json();
    const products = data.result || [];

    // Fetch full details (with variants + images) for each product
    const detailed = await Promise.all(
      products.map(async (p) => {
        const detailRes = await fetch(`https://api.printful.com/sync/products/${p.id}`, {
          headers: {
            Authorization: `Bearer ${process.env.PRINTFUL_API_KEY}`,
          },
        });
        const detail = await detailRes.json();
        const product = detail.result?.sync_product;
        const variants = detail.result?.sync_variants || [];

        // Extract unique sizes from variants
        const sizes = [...new Set(variants.map(v => v.size).filter(Boolean))];

        // Get price from first variant
        const price = variants[0]?.retail_price
          ? parseFloat(variants[0].retail_price)
          : null;

        // Get best preview image from first variant's files array
        const firstVariant = variants[0];
        const previewFile = firstVariant?.files?.find(f => f.type === 'preview');
        const image = previewFile?.preview_url 
          || product?.thumbnail_url 
          || p.thumbnail_url 
          || null;

        // Extract unique colors from variants
        const colors = [...new Set(variants.map(v => v.color).filter(Boolean))];

        return {
          id: product?.id,
          name: product?.name,
          source: 'printful',
          image,
          price,
          sizes: sizes.length > 0 ? sizes : ['ONE SIZE'],
          colors,
          variants: variants.map(v => ({
            id: v.id,
            size: v.size,
            color: v.color,
            price: parseFloat(v.retail_price),
            variantId: v.variant_id,
            image: v.files?.find(f => f.type === 'preview')?.preview_url || image,
          })),
        };
      })
    );

    res.json({ products: detailed });
  } catch (err) {
    console.error('Printful fetch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── STRIPE CHECKOUT ─────────────────────────────────────────────────────────
// POST /api/checkout — creates a Stripe Checkout session and returns the URL
app.post('/api/checkout', async (req, res) => {
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const { cart } = req.body;

    if (!cart || cart.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    const line_items = cart.map(item => ({
      price_data: {
        currency: 'usd',
        product_data: {
          name: `${item.name}${item.size ? ` — ${item.size}` : ''}${item.color ? ` / ${item.color}` : ''}`,
          images: item.image ? [item.image] : [],
          metadata: {
            size: item.size || '',
            color: item.color || '',
            source: item.source || '',
            variantId: String(item.variantId || ''),
          },
        },
        unit_amount: Math.round(item.price * 100),
      },
      quantity: item.qty,
    }));

    // Serialize cart for webhook fulfillment
    const cartMeta = JSON.stringify(cart.map(i => ({
      variantId: i.variantId,
      qty: i.qty,
      size: i.size,
      color: i.color,
      source: i.source,
      name: i.name,
    })));

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items,
      mode: 'payment',
      success_url: `${process.env.SITE_URL || 'http://localhost:5500'}/success.html`,
      cancel_url: `${process.env.SITE_URL || 'http://localhost:5500'}`,
      shipping_address_collection: {
        allowed_countries: ['US', 'CA', 'GB', 'AU'],
      },
      metadata: { cart: cartMeta },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── PRINTFUL ORDER (called after Stripe payment succeeds) ───────────────────
// POST /api/order — submits a fulfilled order to Printful
// Hook this up to a Stripe webhook in production for automatic fulfillment
app.post('/api/order', async (req, res) => {
  try {
    const { recipient, items } = req.body;
    // items should be [{ variantId, quantity }]

    const orderRes = await fetch('https://api.printful.com/orders', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.PRINTFUL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient,
        items: items.map(i => ({
          variant_id: i.variantId,
          quantity: i.quantity,
        })),
      }),
    });

    const data = await orderRes.json();
    res.json(data);
  } catch (err) {
    console.error('Order error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🖤 OMEN server running at http://localhost:${PORT}\n`);
});