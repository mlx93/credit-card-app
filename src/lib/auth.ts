import { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import EmailProvider from 'next-auth/providers/email';
import { createClient } from '@supabase/supabase-js';

// Create Supabase client for NextAuth operations
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const authOptions: NextAuthOptions = {
  debug: process.env.NODE_ENV === 'development',
  // Use database strategy without adapter to avoid schema issues
  session: {
    strategy: 'jwt', // Use JWT instead of database sessions to avoid schema issues
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    EmailProvider({
      from: process.env.EMAIL_FROM || 'noreply@cardcycle.app',
      // For testing - log verification URLs to console
      sendVerificationRequest: async ({ identifier: email, url, provider }) => {
        console.log('=== EMAIL VERIFICATION ===');
        console.log('Email:', email);
        console.log('Verification URL:', url);
        console.log('========================');
        // In production, you'd send the actual email here
        return Promise.resolve();
      },
    }),
  ],
  callbacks: {
    session: async ({ session, token }) => {
      // Add user ID from token to session
      if (session?.user && token?.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
    signIn: async ({ user, account, profile }) => {
      // Create/update user in our database
      if (user.email) {
        try {
          // Check if user already exists
          const { data: existingUser } = await supabase
            .from('users')
            .select('id')
            .eq('email', user.email)
            .single();

          if (!existingUser) {
            // Create new user with UUID
            const { data: newUser, error } = await supabase
              .from('users')
              .insert({
                email: user.email,
                name: user.name,
                image: user.image,
                updatedAt: new Date().toISOString(),
              })
              .select('id')
              .single();

            if (error) {
              console.error('Error creating user:', error);
              return false;
            }

            // Set the user ID for the session
            user.id = newUser.id;
          } else {
            // Update existing user
            await supabase
              .from('users')
              .update({
                name: user.name,
                image: user.image,
                updatedAt: new Date().toISOString(),
              })
              .eq('email', user.email);
            
            user.id = existingUser.id;
          }

          console.log('User handled successfully:', user.email);
        } catch (error) {
          console.error('Error handling user:', error);
          return false;
        }
      }
      return true;
    },
  },
  events: {
    async signIn({ user, account, profile, isNewUser }) {
      console.log('NextAuth signIn event:', { 
        user: user?.email, 
        account: account?.provider,
        isNewUser 
      });
    },
    async signOut({ token, session }) {
      console.log('NextAuth signOut event');
    },
    async createUser({ user }) {
      console.log('NextAuth createUser event:', user?.email);
    },
    async linkAccount({ user, account, profile }) {
      console.log('NextAuth linkAccount event:', { 
        user: user?.email, 
        provider: account.provider 
      });
    },
  },
  logger: {
    error(code, metadata) {
      console.error('NextAuth Error:', code, metadata);
    },
    warn(code) {
      console.warn('NextAuth Warning:', code);
    },
    debug(code, metadata) {
      console.log('NextAuth Debug:', code, metadata);
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};