import { redirect } from 'next/navigation';

export default function CalendarRedirect() {
  redirect('/inbound?tab=calendar');
}
