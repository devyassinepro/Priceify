import { redirect, LoaderFunctionArgs } from "@remix-run/node";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  console.log(`🔄 Legacy billing callback - redirecting to sync: ${url.toString()}`);
  
  // Rediriger vers la nouvelle route de synchronisation
  return redirect("/app/sync-subscription");
};

export default function LegacyBillingCallback() {
  return null; // Ne devrait jamais s'afficher
}