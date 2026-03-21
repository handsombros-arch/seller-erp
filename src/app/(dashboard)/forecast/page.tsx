import { redirect } from 'next/navigation';

export default function ForecastRedirect() {
  redirect('/inventory?tab=forecast');
}
