import { redirect } from 'next/navigation';

export default function TrendsRedirect() {
  redirect('/inventory?tab=trends');
}
