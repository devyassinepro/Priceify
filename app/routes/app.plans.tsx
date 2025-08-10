
import { json, LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useActionData, Form } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import {Card,Layout,Page,Text,Button,Grid,Badge,List,Banner,BlockStack} from "@shopify/polaris";
import { getOrCreateSubscription } from "../models/subscription.server";
import { PLANS } from "../lib/plans";
import { useEffect } from "react";

interface ActionResult {
  success?: boolean;
  error?: string;
  confirmationUrl?: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const subscription = await getOrCreateSubscription(session.shop);  

  const isTestMode = process.env.SHOPIFY_BILLING_TEST === "true" || 
  process.env.NODE_ENV === "development" ||
  session.shop.includes("test-") ||
  session.shop.includes("dev-");

  return json({
    shop: session.shop,
    subscription,
    plans: Object.values(PLANS),
    isTestMode 
  });
};
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  try {
    const formData = await request.formData();
    const selectedPlan = formData.get("plan") as string;
    
    if (!selectedPlan || !PLANS[selectedPlan]) {
      return json<ActionResult>({ error: "Invalid plan selected" });
    }
    
    const plan = PLANS[selectedPlan];
    
    if (plan.name === "free") {
      return json<ActionResult>({ error: "You're already on the free plan" });
    }
    
    console.log(`🔄 Creating billing charge for ${session.shop}: ${plan.displayName}`);
    
    // ✅ CORRECTION: URL de retour avec paramètres pour maintenir le contexte
    const baseUrl = process.env.SHOPIFY_APP_URL || `https://${request.headers.get('host')}`;
    const returnUrl = `${baseUrl}/app/billing/callback?shop=${session.shop}&plan=${plan.name}`;
    
    console.log(`📋 Return URL: ${returnUrl}`);
    
    const isTestMode = process.env.SHOPIFY_BILLING_TEST === "true" || 
                      process.env.NODE_ENV === "development" ||
                      session.shop.includes("test-") ||
                      session.shop.includes("dev-");
    
    console.log(`🧪 Test mode: ${isTestMode}`);
    
    const response = await admin.graphql(`
      mutation AppSubscriptionCreate($name: String!, $returnUrl: URL!, $test: Boolean, $lineItems: [AppSubscriptionLineItemInput!]!) {
        appSubscriptionCreate(name: $name, returnUrl: $returnUrl, test: $test, lineItems: $lineItems) {
          appSubscription {
            id
          }
          confirmationUrl
          userErrors {
            field
            message
          }
        }
      }
    `, {
      variables: {
        name: plan.displayName,
        returnUrl: returnUrl, // ✅ URL avec paramètres
        test: isTestMode,
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                price: { amount: plan.price, currencyCode: "USD" },
                interval: "EVERY_30_DAYS"
              }
            }
          }
        ]
      }
    });
    
    const result = await response.json();
    console.log(`📊 GraphQL response:`, JSON.stringify(result, null, 2));
    
    if (result.data?.appSubscriptionCreate?.userErrors?.length > 0) {
      const errors = result.data.appSubscriptionCreate.userErrors;
      console.error(`❌ Billing errors:`, errors);
      return json<ActionResult>({ 
        error: `Billing error: ${errors.map((e: any) => e.message).join(', ')}`
      });
    }
    
    const confirmationUrl = result.data?.appSubscriptionCreate?.confirmationUrl;
    
    if (!confirmationUrl) {
      console.error(`❌ No confirmation URL received`);
      return json<ActionResult>({ 
        error: "Failed to create subscription - no confirmation URL" 
      });
    }
    
    console.log(`✅ Billing charge created successfully`);
    console.log(`🔗 Confirmation URL: ${confirmationUrl}`);
    
    return json<ActionResult>({ 
      success: true, 
      confirmationUrl 
    });
    
  } catch (error: any) {
    console.error(`💥 Billing creation failed:`, error);
    return json<ActionResult>({ 
      error: `Failed to create subscription: ${error.message}` 
    });
  }
};

export default function Plans() {
  const { shop, subscription, plans,isTestMode } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionResult>();
  
  // ✅ REDIRECTION AUTOMATIQUE VERS SHOPIFY
  useEffect(() => {
    if (actionData?.success && actionData.confirmationUrl) {
      window.top!.location.href = actionData.confirmationUrl;
    }
  }, [actionData]);
  
  return (
    <Page title="Choose Your Plan" backAction={{ content: "← Dashboard", url: "/app" }}>
      <Layout>

          {/* ✅ Afficher un banner en mode test */}
          {isTestMode && (
          <Layout.Section>
            <Banner title="🧪 Test Mode Active" tone="info">
              <Text as="p">
                Billing is in test mode - no real charges will be made. 
                Perfect for testing your subscription flow!
              </Text>
            </Banner>
          </Layout.Section>
        )}
        {actionData?.error && (
          <Layout.Section>
            <Banner title="Subscription Error" tone="critical">
              <Text as="p">{actionData.error}</Text>
            </Banner>
          </Layout.Section>
        )}
        
        {actionData?.success && (
          <Layout.Section>
            <Banner title="🔄 Redirecting to Shopify..." tone="info">
              <Text as="p">Please wait while we redirect you to complete your subscription.</Text>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Grid>
            {plans.map((plan) => (
              <Grid.Cell key={plan.name} columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
                <Card>
                  <div style={{ padding: "2rem", textAlign: "center", minHeight: "400px" }}>
                    <div style={{ marginBottom: "1rem" }}>
                      <Text as="h3" variant="headingLg">{plan.displayName}</Text>
                      {plan.recommended && <Badge tone="success">Most Popular</Badge>}
                    </div>
                    
                    <div style={{ marginBottom: "2rem" }}>
                      <Text as="p" variant="headingXl">
                        {plan.price === 0 ? "Free" : `$${plan.price}`}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {plan.price === 0 ? "Forever" : "per month"}
                      </Text>
                    </div>
                    
                    <div style={{ marginBottom: "2rem" }}>
                      <Text as="p" variant="bodyLg" fontWeight="semibold">
                        {plan.usageLimit === 99999 ? "Unlimited" : plan.usageLimit} products/month
                      </Text>
                    </div>
                    
                    <div style={{ textAlign: "left", marginBottom: "2rem" }}>
                      <List type="bullet">
                        {plan.features.slice(0, 4).map((feature, index) => (
                          <List.Item key={index}>
                            <Text as="span" variant="bodySm">{feature}</Text>
                          </List.Item>
                        ))}
                      </List>
                    </div>
                    
                    <div>
                      {subscription.planName === plan.name ? (
                        <Badge tone="success">Current Plan</Badge>
                      ) : (
                        <Form method="post">
                          <input type="hidden" name="plan" value={plan.name} />
                          <Button
                            submit
                            variant={plan.recommended ? "primary" : "secondary"}
                            size="large"
                            fullWidth
                            disabled={plan.name === "free"}
                          >
                            {plan.name === "free" ? "Free Plan" : `Get ${plan.displayName}`}
                          </Button>
                        </Form>
                      )}
                    </div>
                  </div>
                </Card>
              </Grid.Cell>
            ))}
          </Grid>
        </Layout.Section>
      </Layout>
    </Page>
  );
}