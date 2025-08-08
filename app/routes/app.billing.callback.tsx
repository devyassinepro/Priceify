import { json, LoaderFunctionArgs, redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { updateSubscription } from "../models/subscription.server";
import { PLANS } from "../lib/plans";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const charge_id = url.searchParams.get("charge_id");
  
  console.log(`🔄 Billing callback received for shop: ${session.shop}`);
  console.log(`📋 Charge ID: ${charge_id}`);
  console.log(`🔗 Full callback URL: ${url.toString()}`);
  
  if (!charge_id) {
    console.error("❌ No charge_id parameter found");
    return redirect("/app/billing?error=no_charge_id");
  }

  try {
    console.log(`🔍 Fetching subscription details for charge: ${charge_id}`);
    
    // Get subscription details from Shopify
    const response = await admin.graphql(`
      query GetAppSubscription($id: ID!) {
        node(id: $id) {
          ... on AppSubscription {
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
    `, {
      variables: { id: `gid://shopify/AppSubscription/${charge_id}` }
    });

    const data = await response.json();
    console.log(`📊 Shopify API response:`, JSON.stringify(data, null, 2));
    
    const subscription = data.data?.node;
    
    if (!subscription) {
      console.error("❌ No subscription found in response");
      return redirect("/app/billing?error=subscription_not_found");
    }
    
    console.log(`📋 Subscription status: ${subscription.status}`);
    console.log(`📋 Subscription test mode: ${subscription.test}`);
    
    if (subscription.status !== "ACTIVE") {
      console.error(`❌ Subscription not active: ${subscription.status}`);
      return redirect("/app/billing?error=subscription_not_active");
    }
    
    // Extract pricing information
    const lineItem = subscription.lineItems?.[0];
    const pricingDetails = lineItem?.plan?.pricingDetails;
    const amount = pricingDetails?.price?.amount;
    
    console.log(`💰 Subscription amount: ${amount}`);
    console.log(`💰 Currency: ${pricingDetails?.price?.currencyCode}`);
    console.log(`📅 Billing interval: ${pricingDetails?.interval}`);
    
    // Determine plan based on price with better matching
    let planName = "free";
    if (amount) {
      const priceFloat = parseFloat(amount);
      console.log(`🔍 Matching price: ${priceFloat}`);
      
      // Find matching plan with more flexible price matching
      for (const [key, plan] of Object.entries(PLANS)) {
        console.log(`🔍 Checking plan ${key}: ${plan.price}`);
        if (Math.abs(plan.price - priceFloat) < 0.02) { // Allow small floating point differences
          planName = key;
          console.log(`✅ Matched plan: ${planName}`);
          break;
        }
      }
      
      if (planName === "free" && priceFloat > 0) {
        console.error(`❌ Could not match price ${priceFloat} to any plan`);
        // Still proceed with a default mapping based on price ranges
        if (priceFloat >= 4 && priceFloat <= 6) {
          planName = "standard";
        } else if (priceFloat >= 8 && priceFloat <= 12) {
          planName = "pro";
        }
        console.log(`🔄 Fallback plan assignment: ${planName}`);
      }
    }
   
    console.log(`🔄 Updating local subscription for ${session.shop}: ${planName} (price: ${amount})`);
    
    // Update local subscription with comprehensive data
    const updateData = {
      planName,
      status: "active",
      subscriptionId: charge_id,
      usageLimit: PLANS[planName].usageLimit,
      currentPeriodEnd: subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    };
    
    console.log(`📋 Update data:`, updateData);
    
    const updatedSubscription = await updateSubscription(session.shop, updateData);
    
    console.log(`✅ Local subscription updated successfully:`, {
      shop: updatedSubscription.shop,
      planName: updatedSubscription.planName,
      usageLimit: updatedSubscription.usageLimit,
      status: updatedSubscription.status
    });
    
    // Redirect back to app with success parameter
    console.log(`🔄 Redirecting to app with success flag`);
    return redirect("/app?upgraded=true");
    
  } catch (error: any) {
    console.error("💥 Billing callback error:", error);
    console.error("📋 Error details:", {
      message: error.message,
      stack: error.stack
    });
    
    // Try to provide more specific error information
    let errorParam = "processing_failed";
    if (error.message?.includes('GraphQL')) {
      errorParam = "graphql_error";
    } else if (error.message?.includes('network')) {
      errorParam = "network_error";
    } else if (error.message?.includes('unauthorized')) {
      errorParam = "auth_error";
    }
    
    return redirect(`/app/billing?error=${errorParam}`);
  }
};

export default function BillingCallback() {
  // This component should never render due to redirects
  return (
    <div style={{ padding: "2rem", textAlign: "center" }}>
      <h1>Processing your subscription...</h1>
      <p>Please wait while we confirm your payment with Shopify.</p>
    </div>
  );
}