import { json, LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useActionData, Form } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { updateSubscription, getOrCreateSubscription } from "../models/subscription.server";
import { PLANS } from "../lib/plans";

// Define proper types
type SyncLoaderSuccess = {
  success: true;
  shop: string;
  localSubscription: any;
  shopifySubscriptions: any[];
  canSync: boolean;
};

type SyncLoaderError = {
  success: false;
  error: string;
  shop: string;
};

type SyncLoaderData = SyncLoaderSuccess | SyncLoaderError;

type SyncActionSuccess = {
  success: true;
  message: string;
  syncedPlan: string;
};

type SyncActionError = {
  success: false;
  error: string;
};

type SyncActionData = SyncActionSuccess | SyncActionError;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  
  // Only allow in development or with admin access
  if (process.env.NODE_ENV === "production" && !request.url.includes("?admin=true")) {
    throw new Response("Not Found", { status: 404 });
  }
  
  try {
    const localSub = await getOrCreateSubscription(session.shop);
    
    // Get Shopify subscriptions
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
    const shopifySubscriptions = data.data?.app?.installation?.activeSubscriptions || [];
    
    return json<SyncLoaderSuccess>({
      success: true,
      shop: session.shop,
      localSubscription: localSub,
      shopifySubscriptions,
      canSync: shopifySubscriptions.length > 0
    });
  } catch (error: any) {
    return json<SyncLoaderError>({ 
      success: false, 
      error: error.message, 
      shop: session.shop 
    });
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  
  try {
    // Get active subscription from Shopify
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
    const shopifySubscriptions = data.data?.app?.installation?.activeSubscriptions || [];
    
    if (shopifySubscriptions.length === 0) {
      return json<SyncActionError>({ 
        success: false, 
        error: "No active subscriptions found in Shopify" 
      });
    }
    
    const activeSub = shopifySubscriptions[0]; // Take the first active subscription
    const amount = parseFloat(activeSub.lineItems[0]?.plan?.pricingDetails?.price?.amount || "0");
    
    // Determine correct plan
    let planName = "free";
    for (const [key, plan] of Object.entries(PLANS)) {
      if (Math.abs(plan.price - amount) < 0.02) {
        planName = key;
        break;
      }
    }
    
    // Update local subscription
    await updateSubscription(session.shop, {
      planName,
      status: "active",
      subscriptionId: activeSub.id.split('/').pop(),
      usageLimit: PLANS[planName].usageLimit,
      currentPeriodEnd: new Date(activeSub.currentPeriodEnd)
    });
    
    return json<SyncActionSuccess>({ 
      success: true,
      message: `Successfully synced to ${planName} plan (${amount} ${activeSub.lineItems[0]?.plan?.pricingDetails?.price?.currencyCode})`,
      syncedPlan: planName
    });
    
  } catch (error: any) {
    return json<SyncActionError>({ 
      success: false, 
      error: error.message 
    });
  }
};

export default function SyncSubscriptions() {
  const data = useLoaderData<SyncLoaderData>();
  const actionData = useActionData<SyncActionData>();
  
  if (!data.success) {
    return (
      <div style={{ fontFamily: "monospace", padding: "2rem" }}>
        <h1>🚨 Sync Error</h1>
        <p>Error: {data.error}</p>
      </div>
    );
  }
  
  // TypeScript now knows this is the success case
  const { shop, localSubscription, shopifySubscriptions, canSync } = data;
  
  const needsSync = shopifySubscriptions.length > 0 && 
    localSubscription.planName === "free" &&
    parseFloat(shopifySubscriptions[0]?.lineItems[0]?.plan?.pricingDetails?.price?.amount || "0") > 0;
  
  return (
    <div style={{ fontFamily: "monospace", padding: "2rem" }}>
      <h1>🔄 Emergency Subscription Sync</h1>
      
      <div style={{ marginBottom: "2rem" }}>
        <h2>Current Status</h2>
        <p><strong>Shop:</strong> {shop}</p>
        <p><strong>Local Plan:</strong> {localSubscription.planName}</p>
        <p><strong>Shopify Subscriptions:</strong> {shopifySubscriptions.length}</p>
      </div>
      
      {actionData?.success && (
        <div style={{ background: "#d4edda", padding: "1rem", marginBottom: "1rem", borderRadius: "4px" }}>
          <strong>✅ Sync Successful!</strong>
          <p>{actionData.message}</p>
        </div>
      )}
      
      {actionData && !actionData.success && (
        <div style={{ background: "#f8d7da", padding: "1rem", marginBottom: "1rem", borderRadius: "4px" }}>
          <strong>❌ Sync Failed!</strong>
          <p>{actionData.error}</p>
        </div>
      )}
      
      {needsSync ? (
        <div style={{ background: "#fff3cd", padding: "1rem", marginBottom: "1rem", borderRadius: "4px" }}>
          <strong>⚠️ Sync Required</strong>
          <p>Shopify shows active paid subscription but local database shows free plan.</p>
          
          <Form method="post">
            <button 
              type="submit" 
              style={{ 
                background: "#007bff", 
                color: "white", 
                padding: "0.5rem 1rem", 
                border: "none", 
                borderRadius: "4px",
                marginTop: "1rem"
              }}
            >
              🔄 Sync Now
            </button>
          </Form>
        </div>
      ) : (
        <div style={{ background: "#d4edda", padding: "1rem", marginBottom: "1rem", borderRadius: "4px" }}>
          <strong>✅ No Sync Needed</strong>
          <p>Subscriptions appear to be in sync.</p>
        </div>
      )}
      
      <div>
        <h3>Shopify Subscription Details:</h3>
        <pre style={{ background: "#f5f5f5", padding: "1rem", overflow: "auto", fontSize: "12px" }}>
          {JSON.stringify(shopifySubscriptions, null, 2)}
        </pre>
      </div>
    </div>
  );
}