import { NextRequest, NextResponse } from 'next/server';
import { createServerAuthClient, createServerClient } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  try {
    const {
      firstName, lastName, email, password,
      companyName, phone, website, contractType, fileCount,
    } = await req.json();

    // Validate required fields
    if (!firstName || !lastName || !email || !password || !companyName || !contractType) {
      return NextResponse.json({ error: 'All required fields must be filled.' }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
    }

    const supabaseAdmin = createServerClient();
    const supabaseAuth = createServerAuthClient();

    // 1. Create auth user (or sign in if already exists)
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Skip email confirmation for MVP
      user_metadata: { first_name: firstName, last_name: lastName },
    });

    let userId: string;

    if (authError) {
      // User already exists — try to sign in instead
      if (authError.message.includes('already been registered') || authError.message.includes('already exists')) {
        const { data: signInData, error: signInError } = await supabaseAuth.auth.signInWithPassword({
          email, password,
        });
        if (signInError || !signInData.user) {
          return NextResponse.json(
            { error: 'An account with this email already exists. Please check your password.' },
            { status: 409 }
          );
        }
        userId = signInData.user.id;
      } else {
        return NextResponse.json({ error: authError.message }, { status: 400 });
      }
    } else {
      userId = authData.user.id;

      // 2. Create profile
      const { error: profileError } = await supabaseAdmin.from('profiles').upsert({
        id:           userId,
        email,
        first_name:   firstName,
        last_name:    lastName,
        company_name: companyName,
        phone:        phone || null,
        website:      website || null,
      });

      if (profileError) {
        console.error('Profile upsert error:', profileError);
      }
    }

    // 3. Create the report record
    const { data: report, error: reportError } = await supabaseAdmin
      .from('reports')
      .insert({
        user_id:       userId,
        email,
        status:        'uploading',
        contract_type: contractType,
        file_count:    fileCount ?? 0,
        paid:          false,
      })
      .select('id')
      .single();

    if (reportError || !report) {
      console.error('Report creation error:', reportError);
      return NextResponse.json({ error: 'Failed to create report' }, { status: 500 });
    }

    return NextResponse.json({ reportId: report.id, userId });

  } catch (err) {
    console.error('Reports POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
