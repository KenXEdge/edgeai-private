import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

const PRICE_IDS = {
  base:    'price_1TN2Y5PyMuFPyN5Gl2cTFgVj',
  custom:  'price_1TN2YhPyMuFPyN5GChyx5zvT',
  premium: 'price_1TN2dgPyMuFPyN5Ghu1erL5c',
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { tier, carrier_id, email } = req.body

  if (!PRICE_IDS[tier]) {
    return res.status(400).json({ error: 'Invalid tier' })
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: tier === 'premium' ? 'payment' : 'subscription',
      customer_email: email,
      line_items: [{ price: PRICE_IDS[tier], quantity: 1 }],
      success_url: 'https://xtxtec.com/subscribe?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://xtxtec.com/subscribe?cancelled=true',
      metadata: { carrier_id, tier },
    })

    return res.status(200).json({ url: session.url })
  } catch (err) {
    console.error('[stripe] checkout error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
