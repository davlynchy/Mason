import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createServerClient } from '@/lib/supabase';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(req: NextRequest) {
  try {
    const { reportId } = await req.json();
    if (!reportId) {
      return NextResponse.json({ error: 'Missing reportId' }, { status: 400 });
    }

    const supabase = createServerClient();

    // Get report to find user email
    const { data: report } = await supabase
      .from('reports')
      .select('id, email, paid, status')
      .eq('id', reportId)
      .single();

    if (!report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    if (report.paid) {
      // Already paid — just return to report
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
      return NextResponse.json({ url: `${appUrl}/report/${reportId}` });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const priceAud = parseInt(process.env.REPORT_PRICE_AUD ?? '79900', 10);

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency:     'aud',
            unit_amount:  priceAud,
            product_data: {
              name:        'Mason Contract Risk Review — Full Report',
              description: `Complete risk register, financial summary, and action plan for your ${report.email} contract review.`,
              images:      [`${appUrl}/logo.png`],
            },
          },
          quantity: 1,
        },
      ],
      customer_email: report.email,
      metadata: {
        reportId,
        email: report.email,
      },
      success_url: `${appUrl}/report/${reportId}?payment=success`,
      cancel_url:  `${appUrl}/report/${reportId}?payment=cancelled`,
    });

    // Store session ID on report for webhook lookup
    await supabase
      .from('reports')
      .update({ stripe_session_id: session.id })
      .eq('id', reportId);

    return NextResponse.json({ url: session.url });

  } catch (err) {
    console.error('Checkout error:', err);
    return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 });
  }
}
