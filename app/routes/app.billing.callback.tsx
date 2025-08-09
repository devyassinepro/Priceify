
import { json, LoaderFunctionArgs, redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { updateSubscription } from "../models/subscription.server";
import { PLANS } from "../lib/plans";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  
  console.log(`🔄 Billing callback for ${session.shop}`);
  
  try {
    const response = await admin.graphql(`
      query GetActiveSubscriptions {
        app {
          installation {
            activeSubscriptions {
              id
              name
              status
              currentPeriodEnd
              createdAt
              lineItems {
                plan {
                  pricingDetails {
                    ... on AppRecurringPricing {
                      price {
                        amount
                        currencyCode
                      }
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
    
    if (activeSubscriptions.length === 0) {
      return redirect("/app?error=no_subscription");
    }
    
    const latestSubscription = activeSubscriptions.sort((a: any, b: any) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )[0];
    
    if (latestSubscription.status !== "ACTIVE") {
      return redirect("/app?error=subscription_not_active");
    }
    
    const amount = latestSubscription.lineItems?.[0]?.plan?.pricingDetails?.price?.amount;
    const subscriptionId = latestSubscription.id.split('/').pop();
    
    let planName = "free";
    if (amount) {
      const priceFloat = parseFloat(amount);
      for (const [key, plan] of Object.entries(PLANS)) {
        if (Math.abs(plan.price - priceFloat) < 0.02) {
          planName = key;
          break;
        }
      }
    }
    
    await updateSubscription(session.shop, {
      planName,
      status: "active",
      subscriptionId,
      usageLimit: PLANS[planName].usageLimit,
      currentPeriodEnd: latestSubscription.currentPeriodEnd ? 
        new Date(latestSubscription.currentPeriodEnd) : 
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    
    return redirect(`/app?upgraded=true&plan=${planName}`);
    
  } catch (error: any) {
    console.error("Billing callback error:", error);
    return redirect(`/app?error=processing_failed`);
  }
};

export default function BillingCallback() {
  return (
    <div style={{ padding: "2rem", textAlign: "center" }}>
      <h1>Processing your subscription...</h1>
    </div>
  );
}
