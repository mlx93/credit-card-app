import { getSession } from '@/lib/session';
import { AnalyticsContent } from '@/components/AnalyticsContent';

export default async function Analytics() {
  const session = await getSession();

  if (!session?.user) {
    // Show mock data for logged out users
    return <AnalyticsContent isLoggedIn={false} />;
  }

  // Show real data for logged in users
  return <AnalyticsContent isLoggedIn={true} />;
}