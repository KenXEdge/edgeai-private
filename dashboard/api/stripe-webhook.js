import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// Disable Vercel's body parser — Stripe needs the raw bytes to verify the signature
export const config = {
  api: { bodyParser: false },
}

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const sig = req.headers['stripe-signature']
  let event

  try {
    const rawBody = await getRawBody(req)
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    console.error('[stripe-webhook] signature verification failed:', err.message)
    return res.status(400).json({ error: `Webhook Error: ${err.message}` })
  }

  try {
    switch (event.type) {

      case 'checkout.session.completed': {
        const session = event.data.object
        const carrierId = session.metadata?.carrier_id
        if (!carrierId) {
          console.warn('[stripe-webhook] checkout.session.completed: no carrier_id in metadata')
          break
        }
        const { error } = await supabase
          .from('carriers')
          .update({ subscription_status: 'active' })
          .eq('id', carrierId)
        if (error) console.error('[stripe-webhook] activate failed:', error.message)
        else console.log('[stripe-webhook] activated carrier:', carrierId)
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object
        const customer = await stripe.customers.retrieve(subscription.customer)
        const email = customer.email
        if (!email) {
          console.warn('[stripe-webhook] customer.subscription.deleted: no email on customer')
          break
        }
        const { error } = await supabase
          .from('carriers')
          .update({ subscription_status: 'inactive' })
          .eq('email', email)
        if (error) console.error('[stripe-webhook] deactivate failed:', error.message)
        else console.log('[stripe-webhook] deactivated:', email)
        break
      }

      default:
        // all other events ignored
    }
  } catch (err) {
    console.error('[stripe-webhook] handler error:', err.message)
    return res.status(500).json({ error: 'Internal server error' })
  }

  return res.status(200).json({ received: true })
}
