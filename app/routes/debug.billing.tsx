// app/routes/debug.billing.tsx - Temporary debugging route

import { json, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { getOrCreateSubscription } from "../models/subscription.server";
import { PLANS } from "../lib/plans";

// Define proper types for the loader response
type DebugBillingSuccess = {
  success: true;
  shop: string;
  environment: string;
  appUrl: string | undefined;
  localSubscription: any;
  shopifySubscriptions: any[];
  plans: typeof PLANS;
  timestamp: string;
};

type DebugBillingError = {
  success: false;
  error: string;
  shop: string;
  timestamp: string;
};

type DebugBillingData = DebugBillingSuccess | DebugBillingError;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  
  try {
    // Get local subscription
    const localSubscription = await getOrCreateSubscription(session.shop);
    
    // Get active subscriptions from Shopify
    const response = await admin.graphql(`
      query GetAppSubscriptions {
        app {
          installation {
            activeSubscriptions {
              id
              name
              status
              currentPeriodEnd
              test
              lineItems {
                plan {
                  pricingDetails {
                    ... on AppRecurringPricing {
                      price {
                        amount
                        currencyCode
                      }
                      interval
                    }
                  }
                }
              }
            }
          }
        }
      }
    `);
    
    const data = await response.json();
    const activeSubscriptions = data.data?.app?.installation?.activeSubscriptions || [];
    
    return json<DebugBillingSuccess>({
      success: true,
      shop: session.shop,
      environment: process.env.NODE_ENV as string,
      appUrl: process.env.SHOPIFY_APP_URL,
      localSubscription,
      shopifySubscriptions: activeSubscriptions,
      plans: PLANS,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error("Debug billing error:", error);
    return json<DebugBillingError>({
      success: false,
      error: error.message,
      shop: session.shop,
      timestamp: new Date().toISOString()
    });
  }
};

export default function DebugBilling() {
  const data = useLoaderData<DebugBillingData>();
  
  if (!data.success) {
    return (
      <div style={{ fontFamily: "monospace", padding: "2rem" }}>
        <h1>🚨 Debug Billing - Error</h1>
        <p><strong>Shop:</strong> {data.shop}</p>
        <p><strong>Error:</strong> {data.error}</p>
        <p><strong>Time:</strong> {data.timestamp}</p>
      </div>
    );
  }
  
  // TypeScript now knows this is the success case
  const {
    shop,
    environment,
    appUrl,
    localSubscription,
    shopifySubscriptions,
    plans,
    timestamp
  } = data;
  
  return (
    <div style={{ fontFamily: "monospace", padding: "2rem" }}>
      <h1>🔍 Debug Billing Status</h1>
      
      <div style={{ marginBottom: "2rem" }}>
        <h2>📋 Environment Info</h2>
        <p><strong>Shop:</strong> {shop}</p>
        <p><strong>Environment:</strong> {environment}</p>
        <p><strong>App URL:</strong> {appUrl}</p>
        <p><strong>Generated at:</strong> {timestamp}</p>
      </div>
      
      <div style={{ marginBottom: "2rem" }}>
        <h2>💾 Local Subscription (Database)</h2>
        <pre style={{ background: "#f5f5f5", padding: "1rem", overflow: "auto" }}>
          {JSON.stringify(localSubscription, null, 2)}
        </pre>
      </div>
      
      <div style={{ marginBottom: "2rem" }}>
        <h2>🏪 Shopify Subscriptions (Live)</h2>
        {shopifySubscriptions.length === 0 ? (
          <p style={{ color: "red" }}>❌ No active subscriptions found in Shopify</p>
        ) : (
          <pre style={{ background: "#f5f5f5", padding: "1rem", overflow: "auto" }}>
            {JSON.stringify(shopifySubscriptions, null, 2)}
          </pre>
        )}
      </div>
      
      <div style={{ marginBottom: "2rem" }}>
        <h2>📋 Available Plans (App Configuration)</h2>
        <pre style={{ background: "#f5f5f5", padding: "1rem", overflow: "auto" }}>
          {JSON.stringify(plans, null, 2)}
        </pre>
      </div>
      
      <div style={{ marginBottom: "2rem" }}>
        <h2>🔍 Analysis</h2>
        {shopifySubscriptions.length > 0 ? (
          <div>
            <p style={{ color: "green" }}>✅ Found {shopifySubscriptions.length} active subscription(s) in Shopify</p>
            {shopifySubscriptions.map((sub: any, index: number) => {
              const amount = sub.lineItems?.[0]?.plan?.pricingDetails?.price?.amount;
              const localPlanPrice = plans[localSubscription.planName]?.price;
              
              return (
                <div key={index} style={{ marginLeft: "1rem", marginBottom: "1rem" }}>
                  <p><strong>Subscription {index + 1}:</strong></p>
                  <p>• Status: {sub.status}</p>
                  <p>• Amount: {amount} {sub.lineItems?.[0]?.plan?.pricingDetails?.price?.currencyCode}</p>
                  <p>• Test Mode: {sub.test ? "Yes" : "No"}</p>
                  <p>• Local Plan: {localSubscription.planName} (${localPlanPrice})</p>
                  {amount && parseFloat(amount) !== localPlanPrice && (
                    <p style={{ color: "red" }}>
                      ❌ MISMATCH: Shopify amount ({amount}) !== Local plan price (${localPlanPrice})
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p style={{ color: "red" }}>❌ No active subscriptions in Shopify, but local shows: {localSubscription.planName}</p>
        )}
      </div>
      
      <div style={{ marginTop: "2rem", padding: "1rem", background: "#fff3cd", borderRadius: "4px" }}>
        <h3>🛠️ Next Steps</h3>
        <ul>
          <li>If Shopify shows active paid subscription but local is still "free" → Callback issue</li>
          <li>If amounts don't match → Price configuration issue</li>
          <li>If no Shopify subscriptions → Payment processing issue</li>
          <li>Check browser network tab during subscription flow</li>
          <li>Check application logs for callback errors</li>
        </ul>
      </div>
    </div>
  );
}