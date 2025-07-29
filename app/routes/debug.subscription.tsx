// Ajoutez cette route temporaire: app/routes/debug.subscription.tsx

import { json, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { getOrCreateSubscription } from "../models/subscription.server";
import { db } from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  
  // Get subscription from database directly
  const subscription = await db.subscription.findUnique({
    where: { shop: session.shop }
  });
  
  // Get with helper function
  const subscriptionHelper = await getOrCreateSubscription(session.shop);
  
  return json({
    shop: session.shop,
    directQuery: subscription,
    helperQuery: subscriptionHelper,
    timestamp: new Date().toISOString()
  });
};

export default function DebugSubscription() {
  const { shop, directQuery, helperQuery, timestamp } = useLoaderData<typeof loader>();
  
  return (
    <div style={{ fontFamily: "monospace", padding: "2rem" }}>
      <h1>🔍 Debug Subscription - {shop}</h1>
      <p>Generated at: {timestamp}</p>
      
      <h2>Direct Database Query:</h2>
      <pre style={{ background: "#f5f5f5", padding: "1rem" }}>
        {JSON.stringify(directQuery, null, 2)}
      </pre>
      
      <h2>Helper Function Query:</h2>
      <pre style={{ background: "#f5f5f5", padding: "1rem" }}>
        {JSON.stringify(helperQuery, null, 2)}
      </pre>
    </div>
  );
}