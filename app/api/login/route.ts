import { NextRequest, NextResponse } from 'next/server';
import { createServerAuthClient, createServerClient } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 });
    }

    const supabaseAuth = createServerAuthClient();
    const supabaseAdmin = createServerClient();

    const { data: signInData, error: signInError } = await supabaseAuth.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError || !signInData.user) {
      return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
    }

    const { data: report, error: reportError } = await supabaseAdmin
      .from('reports')
      .select('id')
      .eq('user_id', signInData.user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (reportError) {
      console.error('Login report lookup error:', reportError);
      return NextResponse.json({ error: 'Failed to load your reports.' }, { status: 500 });
    }

    if (!report) {
      return NextResponse.json({ error: 'No reports found for this account yet.' }, { status: 404 });
    }

    return NextResponse.json({ reportId: report.id });
  } catch (err) {
    console.error('Login POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
