import { ActionFunctionArgs, LoaderFunctionArgs, json, redirect } from "@remix-run/node";
import { useLoaderData, useActionData, Form } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { updateSubscription, getOrCreateSubscription } from "../models/subscription.server";
import { PLANS } from "../lib/plans";
import {
  Card,
  Layout,
  Page,
  Text,
  Button,
  Banner,
  BlockStack,
  TextField,
  FormLayout,
} from "@shopify/polaris";

interface ActionResult {
  success?: boolean;
  error?: string;
  detectedPlan?: string;
  message?: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const subscription = await getOrCreateSubscription(session.shop);
  
  return json({
    shop: session.shop,
    subscription,
    plans: PLANS,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  
  try {
    const formData = await request.formData();
    const action = formData.get("action");
    const chargeId = formData.get("chargeId")?.toString();
    const selectedPlan = formData.get("selectedPlan")?.toString();

    if (action === "manual_update" && selectedPlan) {
      // Mise à jour manuelle avec plan sélectionné
      if (!PLANS[selectedPlan]) {
        return json<ActionResult>({
          success: false,
          error: "Invalid plan selected"
        });
      }

      await updateSubscription(session.shop, {
        planName: selectedPlan,
        status: "active",
        usageLimit: PLANS[selectedPlan as keyof typeof PLANS].usageLimit,
        subscriptionId: chargeId || undefined,
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      return json<ActionResult>({
        success: true,
        detectedPlan: selectedPlan,
        message: `Subscription manually updated to ${PLANS[selectedPlan as keyof typeof PLANS].displayName} plan`
      });
    }

    if (action === "fetch_charges") {
      // Récupérer et analyser les charges actives
      console.log(`🔍 Fetching active charges for ${session.shop}`);

      // Essayer d'abord les AppSubscriptions
      const subscriptionsResponse = await admin.graphql(`
        query GetActiveSubscriptions {
          app {
            installation {
              activeSubscriptions {
                id
                name
                status
                currentPeriodEnd
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

      const subscriptionsData = await subscriptionsResponse.json();
      const activeSubscriptions = subscriptionsData.data?.app?.installation?.activeSubscriptions || [];

      if (activeSubscriptions.length > 0) {
        const subscription = activeSubscriptions[0];
        const amount = parseFloat(subscription.lineItems?.[0]?.plan?.pricingDetails?.price?.amount || "0");
        
        // Mapper au plan
        let detectedPlan = "free";
        for (const [planKey, planData] of Object.entries(PLANS)) {
          if (Math.abs(planData.price - amount) < 0.02) {
            detectedPlan = planKey;
            break;
          }
        }

        // Mettre à jour automatiquement
        await updateSubscription(session.shop, {
          planName: detectedPlan,
          status: "active",
          usageLimit: PLANS[detectedPlan as keyof typeof PLANS].usageLimit,
          subscriptionId: subscription.id,
          currentPeriodEnd: subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        });

        return json<ActionResult>({
          success: true,
          detectedPlan,
          message: `Found and synced AppSubscription: ${PLANS[detectedPlan as keyof typeof PLANS].displayName} plan ($${amount})`
        });
      }

      // Essayer les AppRecurringApplicationCharges
      const chargesResponse = await admin.graphql(`
        query GetAppRecurringApplicationCharges($first: Int!) {
          appRecurringApplicationCharges(first: $first) {
            edges {
              node {
                id
                name
                price {
                  amount
                  currencyCode
                }
                status
                createdAt
                activatedOn
              }
            }
          }
        }
      `, {
        variables: { first: 10 }
      });

      const chargesData = await chargesResponse.json();
      const charges = chargesData.data?.appRecurringApplicationCharges?.edges?.map((edge: any) => edge.node) || [];
      const activeCharges = charges.filter((charge: any) => charge.status === "active");

      if (activeCharges.length > 0) {
        const charge = activeCharges[0];
        const amount = parseFloat(charge.price.amount);
        
        // Mapper au plan
        let detectedPlan = "free";
        for (const [planKey, planData] of Object.entries(PLANS)) {
          if (Math.abs(planData.price - amount) < 0.02) {
            detectedPlan = planKey;
            break;
          }
        }

        // Mettre à jour automatiquement
        await updateSubscription(session.shop, {
          planName: detectedPlan,
          status: "active",
          usageLimit: PLANS[detectedPlan as keyof typeof PLANS].usageLimit,
          subscriptionId: charge.id,
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        });

        return json<ActionResult>({
          success: true,
          detectedPlan,
          message: `Found and synced AppRecurringApplicationCharge: ${PLANS[detectedPlan as keyof typeof PLANS].displayName} plan ($${amount})`
        });
      }

      return json<ActionResult>({
        success: false,
        error: "No active charges found on Shopify"
      });
    }

    return json<ActionResult>({
      success: false,
      error: "Invalid action"
    });

  } catch (error: any) {
    console.error("Manual sync error:", error);
    return json<ActionResult>({
      success: false,
      error: `Sync failed: ${error.message}`
    });
  }
};

export default function ManualSync() {
  const { shop, subscription, plans } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionResult>();

  return (
    <Page 
      title="🔧 Manual Subscription Sync" 
      subtitle="Manually synchronize your subscription after payment"
      backAction={{ content: "← Dashboard", url: "/app" }}
    >
      <Layout>
        {/* Results */}
        {actionData && (
          <Layout.Section>
            {actionData.success ? (
              <Banner title="✅ Sync Successful" tone="success">
                <Text as="p">{actionData.message}</Text>
                {actionData.detectedPlan && (
                  <div style={{ marginTop: "1rem" }}>
                    <Button url="/app" variant="primary">
                      🏠 Go to Dashboard
                    </Button>
                  </div>
                )}
              </Banner>
            ) : (
              <Banner title="❌ Sync Failed" tone="critical">
                <Text as="p">{actionData.error}</Text>
              </Banner>
            )}
          </Layout.Section>
        )}

        {/* Current Status */}
        <Layout.Section>
          <Card>
            <div style={{ padding: "1.5rem" }}>
              <BlockStack gap="300">
                <Text as="h2" variant="headingLg">Current Status</Text>
                <Text as="p">
                  <strong>Shop:</strong> {shop}
                </Text>
                <Text as="p">
                  <strong>Current Plan:</strong> {subscription.planName} ({PLANS[subscription.planName as keyof typeof PLANS]?.displayName})
                </Text>
                <Text as="p">
                  <strong>Usage:</strong> {subscription.usageCount} / {subscription.usageLimit} products
                </Text>
                <Text as="p">
                  <strong>Subscription ID:</strong> {subscription.subscriptionId || "None"}
                </Text>
              </BlockStack>
            </div>
          </Card>
        </Layout.Section>

        {/* Auto Sync */}
        <Layout.Section>
          <Card>
            <div style={{ padding: "1.5rem" }}>
              <BlockStack gap="400">
                <Text as="h2" variant="headingLg">🔄 Automatic Sync</Text>
                <Text as="p">
                  Click this button to automatically detect and sync your subscription from Shopify.
                </Text>
                
                <Form method="post">
                  <input type="hidden" name="action" value="fetch_charges" />
                  <Button submit variant="primary" size="large">
                    🔍 Auto-Detect & Sync Subscription
                  </Button>
                </Form>
              </BlockStack>
            </div>
          </Card>
        </Layout.Section>

        {/* Manual Sync */}
        <Layout.Section>
          <Card>
            <div style={{ padding: "1.5rem" }}>
              <BlockStack gap="400">
                <Text as="h2" variant="headingLg">✋ Manual Sync</Text>
                <Text as="p">
                  If auto-detection doesn't work, manually select your plan:
                </Text>
                
                <Form method="post">
                  <FormLayout>
                    <input type="hidden" name="action" value="manual_update" />
                    
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                      <div>
                        <Text as="p" variant="bodySm">Charge ID (optional):</Text>
                        <TextField
                          label=""
                          labelHidden
                          name="chargeId"
                          placeholder="e.g. 29437362347"
                          autoComplete="off"
                        />
                      </div>
                      
                      <div>
                        <Text as="p" variant="bodySm">Select Plan:</Text>
                        <select 
                          name="selectedPlan" 
                          style={{ 
                            width: "100%", 
                            padding: "0.5rem", 
                            border: "1px solid #ccc", 
                            borderRadius: "4px" 
                          }}
                        >
                          {Object.entries(plans).map(([key, plan]) => (
                            <option key={key} value={key}>
                              {plan.displayName} - ${plan.price}/month
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    
                    <Button submit variant="secondary" size="large">
                      🔧 Manual Update
                    </Button>
                  </FormLayout>
                </Form>
              </BlockStack>
            </div>
          </Card>
        </Layout.Section>

        {/* Instructions */}
        <Layout.Section>
          <Card>
            <div style={{ padding: "1.5rem" }}>
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">📋 When to Use This</Text>
                <div style={{ display: "grid", gap: "0.5rem" }}>
                  <Text as="p" variant="bodySm">
                    • After completing a payment on Shopify but plan still shows "free"
                  </Text>
                  <Text as="p" variant="bodySm">
                    • When the automatic billing return process fails
                  </Text>
                  <Text as="p" variant="bodySm">
                    • To force-sync your subscription status
                  </Text>
                  <Text as="p" variant="bodySm">
                    • For troubleshooting billing issues
                  </Text>
                </div>
              </BlockStack>
            </div>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}