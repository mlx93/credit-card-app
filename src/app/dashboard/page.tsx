import { getSession } from '@/lib/session';
import { DashboardContent } from '@/components/DashboardContent';

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  const session = await getSession();

  if (!session?.user) {
    // Show mock data for logged out users
    return <DashboardContent isLoggedIn={false} />;
  }

  // Show real data for logged in users
  return <DashboardContent isLoggedIn={true} userEmail={session.user.email} />;
}