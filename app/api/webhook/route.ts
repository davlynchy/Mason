import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createServerClient } from '@/lib/supabase';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// Must disable body parsing for Stripe webhook signature verification
export const config = { api: { bodyParser: false } };

export async function POST(req: NextRequest) {
  const sig = req.headers.get('stripe-signature');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

  if (!sig) {
    return NextResponse.json({ error: 'No signature' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    const body = await req.text();
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature error:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // Handle successful payment
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const reportId = session.metadata?.reportId;

    if (!reportId) {
      console.error('No reportId in session metadata');
      return NextResponse.json({ received: true });
    }

    const supabase = createServerClient();

    // Mark report as paid
    const { error } = await supabase
      .from('reports')
      .update({
        paid:              true,
        stripe_session_id: session.id,
      })
      .eq('id', reportId);

    if (error) {
      console.error(`Failed to mark report ${reportId} as paid:`, error);
      return NextResponse.json({ error: 'Database update failed' }, { status: 500 });
    }

    console.log(`Report ${reportId} marked as paid.`);

    // TODO: Send confirmation email with report access link
    // await sendConfirmationEmail(session.customer_email, reportId);
  }

  return NextResponse.json({ received: true });
}
