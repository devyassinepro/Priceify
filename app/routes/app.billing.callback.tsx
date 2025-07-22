import { json, LoaderFunctionArgs } from "@remix-run/node";
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
    return json({ 
      success: false, 
      message: "No subscription ID provided" 
    });
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
        Object.entries(PLANS).forEach(([key, plan]) => {
          if (plan.price === parseFloat(amount)) {
            planName = key;
          }
        });
      }
      
      // Update local subscription
      await updateSubscription(session.shop, {
        planName,
        status: "active",
        subscriptionId: charge_id,
        usageLimit: PLANS[planName].usageLimit,
        currentPeriodEnd: subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : undefined,
      });
      
      return json({ 
        success: true, 
        planName,
        message: `Successfully upgraded to ${PLANS[planName].displayName}!` 
      });
    }
    
    return json({ 
      success: false, 
      message: "Subscription not activated" 
    });
    
  } catch (error: any) {
    console.error("Callback error:", error);
    return json({ 
      success: false, 
      message: "Error processing subscription" 
    });
  }
};

export default function BillingCallback() {
  const { success, message } = useLoaderData<typeof loader>();
  
  return (
    <Page title="Subscription Update">
      <Layout>
        <Layout.Section>
          <Card>
            <div style={{ padding: "2rem", textAlign: "center" }}>
              <Banner tone={success ? "success" : "critical"} title={success ? "Success!" : "Error"}>
                <Text as="p">{message}</Text>
              </Banner>
              
              <div style={{ marginTop: "2rem" }}>
                <Button 
                  variant="primary" 
                  url="/app/billing"
                >
                  Return to Billing
                </Button>
              </div>
            </div>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}