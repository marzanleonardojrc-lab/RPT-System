import { supabase } from './supabase';
import { UserProfile, UserRole } from '../types';

/**
 * Gets the current active session from Supabase Auth.
 */
export async function getCurrentSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.error('Supabase: Error getting current session:', error);
    throw error;
  }
  return data.session;
}

/**
 * Gets the current authenticated user from Supabase.
 */
export async function getCurrentUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    console.error('Supabase: Error getting current user:', error);
    throw error;
  }
  return data.user;
}

/**
 * Listens for auth state changes (sign in, sign out, etc.) and executes the callback.
 * Supabase handles session storage and persistence automatically (using localStorage/sessionStorage by default).
 * 
 * @param callback Function to be called with the session and user on state changes.
 * @returns The subscription object to unsubscribe when the component unmounts.
 */
export function onSessionStateChange(callback: (session: any, user: any) => void) {
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session, session?.user ?? null);
  });
  return subscription;
}

/**
 * Signs in a user using email or username and password.
 * If a username is provided, it first resolves the corresponding email from the `users` table.
 */
export async function signInWithEmail(emailOrUsername: string, pass: string) {
  let email = emailOrUsername;
  
  if (!emailOrUsername.includes('@')) {
    // Resolve email from username
    const { data, error } = await supabase
      .from('users')
      .select('email')
      .eq('username', emailOrUsername.toLowerCase())
      .maybeSingle();

    if (error || !data) {
      throw new Error('User with this username not found.');
    }
    email = data.email;
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: pass,
  });

  if (error) {
    console.error('Supabase: Sign in failed:', error);
    throw error;
  }

  return data;
}

/**
 * Signs up a new user and provisions their profile record in the `users` table.
 * It also checks for username uniqueness to avoid conflicts.
 */
export async function signUpWithEmail(
  email: string,
  pass: string,
  name: string,
  username: string,
  targetRole: UserRole = 'User',
  linkedPropertyIds?: string[],
  designation?: string
) {
  const formattedUsername = username.replace(/\s+/g, '').toLowerCase();

  // 1. Check if the username is already taken in the public users/profile table
  const { data: existingUser, error: checkError } = await supabase
    .from('users')
    .select('uid')
    .eq('username', formattedUsername)
    .maybeSingle();

  if (checkError) {
    console.warn('Supabase: Error checking username uniqueness, proceeding with caution:', checkError);
  }

  if (existingUser) {
    throw new Error('Username already in use.');
  }

  // 2. Sign up the user in Supabase Auth
  const { data, error } = await supabase.auth.signUp({
    email,
    password: pass,
    options: {
      data: {
        displayName: name,
        username: formattedUsername,
        role: targetRole,
        designation: designation || "Treasury Tax Encoder",
      },
    },
  });

  if (error) {
    console.error('Supabase: Sign up failed:', error);
    throw error;
  }

  if (data.user) {
    const isAdminEmail = email === 'marzanleonardojrc@gmail.com' || email === 'marzan.leonardo04@gmail.com';
    const assignedRole = isAdminEmail ? 'Admin' : targetRole;
    const assignedStatus = (isAdminEmail || targetRole === 'Taxpayer') ? 'Approved' : 'Pending';

    // 3. Create a corresponding profile in the public/users table
    const profileData: any = {
      uid: data.user.id,
      email,
      displayName: name,
      display_name: name,
      username: formattedUsername,
      role: assignedRole,
      status: assignedStatus as any,
      createdAt: new Date().toISOString(),
      created_at: new Date().toISOString(),
      linkedPropertyIds: linkedPropertyIds || [],
      linked_property_ids: linkedPropertyIds || [],
      designation: designation || "Treasury Tax Encoder",
    };

    const { error: insertError } = await supabase
      .from('users')
      .upsert(profileData);

    if (insertError) {
      console.error('Supabase: Failed to create/upsert user profile row:', insertError);
    }

    // Concurrently write to staff_profiles for Relational Database consistency
    if (assignedRole === 'User' || assignedRole === 'End-User') {
      const staffProfileData = {
        uid: data.user.id,
        email,
        display_name: name,
        username: formattedUsername,
        designation: designation || "Treasury Tax Encoder",
        status: assignedStatus,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const { error: staffProfileError } = await supabase
        .from('staff_profiles')
        .upsert(staffProfileData);

      if (staffProfileError) {
        console.error('Supabase: Failed to concurrently write to staff_profiles table:', staffProfileError);
      }
    }
  }

  return data;
}

/**
 * Signs in a user using Google OAuth.
 */
export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
    }
  });

  if (error) {
    console.error('Supabase: Google Sign In failed:', error);
    throw error;
  }

  return data;
}

/**
 * Sends a password reset email to the user.
 */
export async function resetPassword(emailOrUsername: string) {
  let email = emailOrUsername;

  if (!emailOrUsername.includes('@')) {
    const { data, error } = await supabase
      .from('users')
      .select('email')
      .eq('username', emailOrUsername.toLowerCase())
      .maybeSingle();

    if (error || !data) {
      throw new Error('User with this username not found.');
    }
    email = data.email;
  }

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  });

  if (error) {
    console.error('Supabase: Password reset failed:', error);
    throw error;
  }
}

/**
 * Updates the user's display name metadata and syncs it with the `users` table.
 */
export async function updateUserName(name: string) {
  const { data, error } = await supabase.auth.updateUser({
    data: { displayName: name }
  });

  if (error) {
    console.error('Supabase: Update display name failed:', error);
    throw error;
  }

  if (data.user) {
    const { error: profileError } = await supabase
      .from('users')
      .update({ displayName: name })
      .eq('uid', data.user.id);

    if (profileError) {
      console.error('Supabase: Error syncing profile name:', profileError);
    }
  }

  return data;
}

/**
 * Updates the user's username metadata and syncs it with the `users` table.
 */
export async function updateUserUsername(username: string) {
  const formattedUsername = username.replace(/\s+/g, '').toLowerCase();

  // Check username uniqueness
  const { data: existingUser, error: checkError } = await supabase
    .from('users')
    .select('uid')
    .eq('username', formattedUsername)
    .maybeSingle();

  if (checkError) {
    console.warn('Supabase: Error checking username uniqueness:', checkError);
  }

  if (existingUser) {
    throw new Error('Username already in use.');
  }

  const { data, error } = await supabase.auth.updateUser({
    data: { username: formattedUsername }
  });

  if (error) {
    console.error('Supabase: Update username failed:', error);
    throw error;
  }

  if (data.user) {
    const { error: profileError } = await supabase
      .from('users')
      .update({ username: formattedUsername })
      .eq('uid', data.user.id);

    if (profileError) {
      console.error('Supabase: Error syncing profile username:', profileError);
    }
  }

  return data;
}

/**
 * Updates the current authenticated user's password.
 */
export async function updateUserPassword(pass: string) {
  const { data, error } = await supabase.auth.updateUser({
    password: pass
  });

  if (error) {
    console.error('Supabase: Update password failed:', error);
    throw error;
  }

  return data;
}

/**
 * Retrieves a user profile record from the public/users database table.
 */
export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('uid', userId)
    .maybeSingle();

  if (error) {
    console.error('Supabase: Error fetching user profile row:', error);
    return null;
  }

  if (!data) return null;

  let linkedPropertyIds: string[] = [];
  const rawLinked = data.linkedPropertyIds ?? data.linked_property_ids;
  if (Array.isArray(rawLinked)) {
    linkedPropertyIds = rawLinked;
  } else if (typeof rawLinked === 'string') {
    try {
      linkedPropertyIds = JSON.parse(rawLinked);
    } catch {
      linkedPropertyIds = rawLinked.split(',').map(s => s.trim()).filter(Boolean);
    }
  }

  return {
    uid: data.uid || userId,
    email: data.email || "",
    displayName: data.displayName || data.display_name || data.email?.split('@')[0] || "User",
    username: data.username || "",
    role: data.role || "User",
    status: data.status || "Approved",
    createdAt: data.createdAt || data.created_at || new Date().toISOString(),
    linkedPropertyIds: Array.isArray(linkedPropertyIds) ? linkedPropertyIds : [],
    designation: data.designation || "",
  };
}

/**
 * Signs the user out from Supabase Auth.
 */
export async function logout() {
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error('Supabase: Sign out failed:', error);
    throw error;
  }
}
