import { json, LoaderFunctionArgs, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { Card, Layout, Page, Banner, Text, Button } from "@shopify/polaris";
import { updateSubscription } from "../models/subscription.server";
import { PLANS } from "../lib/plans";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const charge_id = url.searchParams.get("charge_id");
  
  if (!charge_id) {
    return redirect("/app/billing?error=no_charge_id");
  }

  try {
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
    const subscription = data.data?.node;
    
    if (subscription && subscription.status === "ACTIVE") {
      // Determine plan based on price
      let planName = "free";
      const amount = subscription.lineItems[0]?.plan?.pricingDetails?.price?.amount;
      
      if (amount) {
        const priceFloat = parseFloat(amount);
        Object.entries(PLANS).forEach(([key, plan]) => {
          if (Math.abs(plan.price - priceFloat) < 0.01) { // Compare with small tolerance
            planName = key;
          }
        });
      }
   
      console.log(`🔄 Updating subscription for ${session.shop}: ${planName} (price: ${amount})`);
      
      // Update local subscription with proper limits
      await updateSubscription(session.shop, {
        planName,
        status: "active",
        subscriptionId: charge_id,
        usageLimit: PLANS[planName].usageLimit,
        currentPeriodEnd: subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : undefined,
      });
      
      console.log(`✅ Subscription updated successfully: ${PLANS[planName].displayName}`);
      
      // Redirect back to app instead of showing success page
      return redirect("/app?upgraded=true");
    }
    
    return redirect("/app/billing?error=subscription_not_active");
    
  } catch (error: any) {
    console.error("Callback error:", error);
    return redirect("/app/billing?error=processing_failed");
  }
};
export default function BillingCallback() {
  // This should never be reached due to redirects above
  return (
    <Page title="Processing...">
      <Layout>
        <Layout.Section>
          <Card>
            <div style={{ padding: "2rem", textAlign: "center" }}>
              <Text as="p">Processing your subscription...</Text>
            </div>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}