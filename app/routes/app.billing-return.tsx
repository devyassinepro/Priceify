// app/routes/app.billing-return.tsx - Dedicated billing callback handler

import { json, LoaderFunctionArgs, redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { updateSubscription } from "../models/subscription.server";
import { PLANS } from "../lib/plans";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const url = new URL(request.url);
    const charge_id = url.searchParams.get("charge_id");
    
    console.log(`🔄 =================BILLING RETURN HANDLER================`);
    console.log(`⏰ Timestamp: ${new Date().toISOString()}`);
    console.log(`💳 Charge ID: ${charge_id}`);
    console.log(`🔗 Full URL: ${url.toString()}`);
    
    if (!charge_id) {
      console.log(`ℹ️ No charge_id found, redirecting to main app`);
      return redirect("/app");
    }
    
    // Authenticate with more graceful error handling
    let session, admin;
    try {
      const auth = await authenticate.admin(request);
      session = auth.session;
      admin = auth.admin;
      console.log(`✅ Authentication successful for: ${session.shop}`);
    } catch (authError) {
      console.error(`❌ Authentication failed:`, authError);
      // If auth fails, try to redirect with the charge_id preserved
      return redirect(`/auth/login?shop=${url.searchParams.get('shop')}&return_to=${encodeURIComponent(`/app?charge_id=${charge_id}`)}`);
    }
    
    // Process the billing callback
    console.log(`🔍 Fetching subscription details for charge: ${charge_id}`);
    
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
    
    // if (data.errors) {
    //   console.error(`❌ GraphQL errors:`, data.errors);
    //   return redirect("/app/billing?error=graphql_error");
    // }
    
    const subscription = data.data?.node;
    
    if (!subscription) {
      console.error(`❌ No subscription found in response`);
      return redirect("/app/billing?error=subscription_not_found");
    }
    
    console.log(`📋 Subscription status: ${subscription.status}`);
    
    if (subscription.status !== "ACTIVE") {
      console.error(`❌ Subscription not active: ${subscription.status}`);
      return redirect("/app/billing?error=subscription_not_active");
    }
    
    // Extract pricing information and determine plan
    const amount = subscription.lineItems?.[0]?.plan?.pricingDetails?.price?.amount;
    console.log(`💰 Subscription amount: ${amount}`);
    
    let planName = "free";
    if (amount) {
      const priceFloat = parseFloat(amount);
      console.log(`🔍 Matching price: ${priceFloat}`);
      
      // Find matching plan
      for (const [key, plan] of Object.entries(PLANS)) {
        console.log(`🔍 Checking plan ${key}: $${plan.price}`);
        if (Math.abs(plan.price - priceFloat) < 0.02) {
          planName = key;
          console.log(`✅ Matched plan: ${planName}`);
          break;
        }
      }
      
      // Enhanced fallback matching
      if (planName === "free" && priceFloat > 0) {
        console.error(`❌ Could not match price ${priceFloat} to any plan`);
        console.log(`🔍 Available plans:`, Object.entries(PLANS).map(([key, plan]) => `${key}: $${plan.price}`));
        
        if (priceFloat >= 4.50 && priceFloat <= 5.50) {
          planName = "standard";
        } else if (priceFloat >= 9.50 && priceFloat <= 10.50) {
          planName = "pro";
        }
        console.log(`🔄 Fallback plan assignment: ${planName}`);
        
        if (planName === "free") {
          console.error(`🚨 CRITICAL: Unable to match price ${priceFloat} to any plan!`);
        }
      }
    }
    
    // Update local subscription
    console.log(`🔄 Updating local subscription for ${session.shop}: ${planName}`);
    
    const updateData = {
      planName,
      status: "active",
      subscriptionId: charge_id,
      usageLimit: PLANS[planName].usageLimit,
      currentPeriodEnd: subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : undefined,
    };
    
    console.log(`📋 Update data:`, updateData);
    
    const updatedSubscription = await updateSubscription(session.shop, updateData);
    
    console.log(`✅ Local subscription updated successfully:`, {
      shop: updatedSubscription.shop,
      planName: updatedSubscription.planName,
      usageLimit: updatedSubscription.usageLimit,
      status: updatedSubscription.status
    });
    
    console.log(`🚀 =================BILLING CALLBACK SUCCESS==================`);
    
    // Redirect to main app with success flag
    return redirect("/app?upgraded=true");
    
  } catch (error: any) {
    console.error(`💥 =================BILLING CALLBACK ERROR===============`);
    console.error(`❌ Error Type: ${error.constructor.name}`);
    console.error(`❌ Error Message: ${error.message}`);
    console.error(`❌ Error Stack:`, error.stack);
    console.error(`💥 =======================================================`);
    
    // Redirect to billing page with error
    return redirect("/app/billing?error=processing_failed");
  }
};

export default function BillingReturn() {
  // This component should never render due to redirects
  return (
    <div style={{ padding: "2rem", textAlign: "center" }}>
      <h1>Processing your subscription...</h1>
      <p>Please wait while we confirm your payment with Shopify.</p>
    </div>
  );
}