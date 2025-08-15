// app/routes/webhooks.app.subscriptions_update.tsx
import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { updateSubscription, getOrCreateSubscription } from "../models/subscription.server";
import { PLANS } from "../lib/plans";

export const action = async ({ request }: ActionFunctionArgs) => {
  console.log("🔄 App subscription update webhook received");
  
  try {
    const { payload, shop, topic } = await authenticate.webhook(request);
    
    console.log(`📋 Processing ${topic} for ${shop}`);
    console.log(`📦 Payload:`, JSON.stringify(payload, null, 2));

    const subscriptionData = payload.app_subscription;
    
    if (!subscriptionData) {
      console.error("❌ No subscription data in payload");
      return new Response("Missing subscription data", { status: 400 });
    }

    console.log(`🔍 Subscription status: ${subscriptionData.status}`);
    console.log(`💰 Subscription ID: ${subscriptionData.id}`);

    // Get current local subscription
    const localSubscription = await getOrCreateSubscription(shop);
    
    if (subscriptionData.status === "CANCELLED" || subscriptionData.status === "EXPIRED") {
      console.log("🚫 Subscription cancelled/expired - reverting to free plan");
      
      await updateSubscription(shop, {
        planName: "free",
        status: "active",
        usageLimit: PLANS.free.usageLimit,
        subscriptionId: undefined,
        currentPeriodEnd: undefined,
      });
      
      console.log("✅ Reverted to free plan");
      return new Response(null, { status: 200 });
    }

    if (subscriptionData.status === "ACTIVE") {
      // Extract pricing information
      const lineItems = subscriptionData.line_items || [];
      if (lineItems.length === 0) {
        console.error("❌ No line items found in subscription");
        return new Response("No line items", { status: 400 });
      }

      const amount = parseFloat(lineItems[0]?.pricing_details?.price?.amount || "0");
      console.log(`💵 Subscription amount: $${amount}`);

      // Map amount to plan
      let detectedPlan = "free";
      for (const [planKey, planData] of Object.entries(PLANS)) {
        if (Math.abs(planData.price - amount) < 0.02) { // 2 cent tolerance
          detectedPlan = planKey;
          break;
        }
      }

      console.log(`📊 Detected plan: ${detectedPlan}`);

      const currentPeriodEnd = subscriptionData.current_period_end 
        ? new Date(subscriptionData.current_period_end) 
        : undefined;

      await updateSubscription(shop, {
        planName: detectedPlan,
        status: subscriptionData.status.toLowerCase(),
        usageLimit: PLANS[detectedPlan as keyof typeof PLANS].usageLimit,
        subscriptionId: subscriptionData.id,
        currentPeriodEnd,
      });

      console.log(`✅ Updated subscription to ${detectedPlan} plan`);
    }
    
    console.log("✅ Subscription update webhook processed successfully");
    return new Response(null, { status: 200 });
    
  } catch (error: any) {
    console.error("❌ Subscription update webhook error:", error);
    
    // Check for HMAC validation errors
    if (
      error.message?.toLowerCase().includes('unauthorized') ||
      error.message?.toLowerCase().includes('hmac') ||
      error.status === 401
    ) {
      console.log("🚨 HMAC validation failed - returning 401");
      return new Response("Unauthorized", { status: 401 });
    }
    
    // For other errors, return 500
    return new Response("Internal Server Error", { status: 500 });
  }
};