import { redirect } from 'next/navigation';

export default function OutboundRedirect() {
  redirect('/inbound?tab=outbound');
}
