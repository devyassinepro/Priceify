
import { redirect, LoaderFunctionArgs } from "@remix-run/node";

export const loader2 = async ({ request }: LoaderFunctionArgs) => {
    const url = new URL(request.url);
    console.log(`🔄 Legacy billing return - redirecting to sync: ${url.toString()}`);
    
    return redirect("/app/sync-subscription");
  };
  
  // app/routes/billing.callback.tsx - Redirection vers sync
  export const loader3 = async ({ request }: LoaderFunctionArgs) => {
    const url = new URL(request.url);
    console.log(`🔄 Root billing callback - redirecting to app sync: ${url.toString()}`);
    
    return redirect("/app/sync-subscription");
  };