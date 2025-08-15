// app/routes/app.billing.tsx
import React from "react";
import { json, LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useActionData, useSubmit } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { Card, Layout, Page, Text, Button, Grid, Badge, List, Banner, BlockStack } from "@shopify/polaris";
import { getOrCreateSubscription, updateSubscription } from "../models/subscription.server";
import { PLANS, formatPriceDisplay } from "../lib/plans";

interface ActionResult {
  success?: string;
  error?: string;
  confirmationUrl?: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const subscription = await getOrCreateSubscription(session.shop);

  return json({
    shop: session.shop,
    subscription,
    plans: Object.values(PLANS),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  try {
    const formData = await request.formData();
    const selectedPlan = formData.get("plan");
    const actionType = formData.get("action");

    if (!selectedPlan || typeof selectedPlan !== "string") {
      return json<ActionResult>({ error: "Invalid plan selected" });
    }

    if (!PLANS[selectedPlan]) {
      return json<ActionResult>({ error: "Plan not found" });
    }

    const plan = PLANS[selectedPlan];

    // Handle cancellation
    if (actionType === "cancel") {
      await updateSubscription(session.shop, {
        planName: "free",
        status: "active",
        usageLimit: PLANS.free.usageLimit,
        subscriptionId: undefined,
      });

      return json<ActionResult>({ success: "Subscription cancelled successfully" });
    }

    // Handle free plan
    if (plan.name === "free") {
      return json<ActionResult>({ error: "You're already on the free plan" });
    }

    console.log(`🔄 Creating billing charge for ${session.shop}: ${plan.displayName}`);

    // Get the correct app URL from the request headers or environment
    const protocol = request.headers.get('x-forwarded-proto') || 'https';
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || process.env.SHOPIFY_APP_URL?.replace(/^https?:\/\//, '');
    const baseUrl = `${protocol}://${host}`;
    
    console.log(`📍 Using base URL: ${baseUrl}`);
    
    // ✅ CORRECTION: URL de retour vers la route billing-return
    const returnUrl = `${baseUrl}/billing-return?shop=${session.shop}`;
    console.log(`🔗 Return URL: ${returnUrl}`);
    
    // Create Shopify subscription using App Subscriptions API
    const response = await admin.graphql(`
      mutation AppSubscriptionCreate($name: String!, $returnUrl: URL!, $test: Boolean!, $lineItems: [AppSubscriptionLineItemInput!]!) {
        appSubscriptionCreate(name: $name, returnUrl: $returnUrl, test: $test, lineItems: $lineItems) {
          appSubscription {
            id
            name
            status
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
        name: `${plan.displayName} Plan`,
        returnUrl,
        test: true, // Toujours utiliser le mode test pour éviter les charges réelles pendant le développement
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
    console.log('GraphQL Response:', JSON.stringify(result, null, 2));

    if (result.data?.appSubscriptionCreate?.userErrors?.length > 0) {
      const errors = result.data.appSubscriptionCreate.userErrors;
      console.error('Subscription creation errors:', errors);
      return json<ActionResult>({
        error: `Billing error: ${errors.map((e: any) => e.message).join(', ')}`
      });
    }

    const confirmationUrl = result.data?.appSubscriptionCreate?.confirmationUrl;
    const subscriptionId = result.data?.appSubscriptionCreate?.appSubscription?.id;

    if (!confirmationUrl) {
      return json<ActionResult>({
        error: "Failed to create subscription - no confirmation URL"
      });
    }

    console.log(`✅ Billing charge created successfully`);
    console.log(`🔗 Confirmation URL: ${confirmationUrl}`);
    console.log(`🆔 Subscription ID: ${subscriptionId}`);

    // Store the subscription ID for future reference
    if (subscriptionId) {
      await updateSubscription(session.shop, {
        subscriptionId: subscriptionId,
      });
    }

    return json<ActionResult>({
      success: "Redirecting to billing...",
      confirmationUrl
    });

  } catch (error: any) {
    console.error(`💥 Billing creation failed:`, error);
    return json<ActionResult>({
      error: `Failed to create subscription: ${error.message}`
    });
  }
};

export default function Billing() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionResult>();
  const submit = useSubmit();

  const { shop, subscription, plans } = loaderData;

  // Redirect to Shopify billing confirmation page
  React.useEffect(() => {
    if (actionData?.confirmationUrl) {
      console.log('Redirecting to:', actionData.confirmationUrl);
      // Use window.top to ensure we break out of iframe if embedded
      if (window.top) {
        window.top.location.href = actionData.confirmationUrl;
      } else {
        window.location.href = actionData.confirmationUrl;
      }
    }
  }, [actionData]);

  const handlePlanAction = (planName: string) => {
    const formData = new FormData();
    formData.append("plan", planName);
    submit(formData, { method: "post" });
  };

  const handleCancelAction = () => {
    if (confirm("Are you sure you want to cancel your subscription? You'll be moved to the free plan.")) {
      const formData = new FormData();
      formData.append("plan", "free");
      formData.append("action", "cancel");
      submit(formData, { method: "post" });
    }
  };

  return (
    <Page title="Choose Your Plan" backAction={{ content: "← Dashboard", url: "/app" }}>
      <Layout>
        {/* Action feedback banners */}
        {actionData?.error && (
          <Layout.Section>
            <Banner title="Subscription Error" tone="critical">
              <Text as="p">{actionData.error}</Text>
            </Banner>
          </Layout.Section>
        )}

        {actionData?.success && !actionData.confirmationUrl && (
          <Layout.Section>
            <Banner title="Success" tone="success">
              <Text as="p">{actionData.success}</Text>
            </Banner>
          </Layout.Section>
        )}

        {actionData?.confirmationUrl && (
          <Layout.Section>
            <Banner title="🔄 Redirecting to Shopify..." tone="info">
              <Text as="p">Please wait while we redirect you to complete your subscription.</Text>
            </Banner>
          </Layout.Section>
        )}

        {/* Current subscription info */}
        <Layout.Section>
          <Card>
            <div style={{ padding: "1.5rem" }}>
              <BlockStack gap="300">
                <Text as="h2" variant="headingLg">Current Subscription</Text>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <Text as="p" variant="bodyLg" fontWeight="semibold">
                      {PLANS[subscription.planName as keyof typeof PLANS]?.displayName || subscription.planName} Plan
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {subscription.usageCount} / {subscription.usageLimit} products used this month
                    </Text>
                  </div>
                  <Badge tone={subscription.planName === 'free' ? 'info' : 'success'}>
                    {formatPriceDisplay(PLANS[subscription.planName as keyof typeof PLANS]?.price || 0)}
                  </Badge>
                </div>
              </BlockStack>
            </div>
          </Card>
        </Layout.Section>

        {/* Available plans */}
        <Layout.Section>
          <Grid>
            {plans.map((plan: any) => {
              const isCurrentPlan = subscription.planName === plan.name;
              const canDowngrade = plan.name === 'free' && subscription.planName !== 'free';
              
              return (
                <Grid.Cell key={plan.name} columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
                  <Card>
                    <div style={{ 
                      padding: "2rem", 
                      textAlign: "center", 
                      minHeight: "500px",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between"
                    }}>
                      <div>
                        <div style={{ marginBottom: "1rem" }}>
                          <Text as="h3" variant="headingLg">{plan.displayName}</Text>
                          {plan.recommended && <Badge tone="success">Most Popular</Badge>}
                          {isCurrentPlan && <Badge tone="info">Current Plan</Badge>}
                        </div>

                        <div style={{ marginBottom: "2rem" }}>
                          <Text as="p" variant="headingXl" fontWeight="bold">
                            {formatPriceDisplay(plan.price)}
                          </Text>
                        </div>

                        <div style={{ marginBottom: "2rem" }}>
                          <Text as="p" variant="bodyLg" fontWeight="semibold">
                            {plan.usageLimit === 99999 ? "Unlimited" : plan.usageLimit} products/month
                          </Text>
                        </div>

                        <div style={{ textAlign: "left", marginBottom: "2rem" }}>
                          <List type="bullet">
                            {plan.features.slice(0, 6).map((feature: string, index: number) => (
                              <List.Item key={index}>
                                <Text as="span" variant="bodySm">{feature}</Text>
                              </List.Item>
                            ))}
                          </List>
                        </div>
                      </div>

                      <div>
                        {isCurrentPlan ? (
                          <div>
                            <Button disabled fullWidth size="large">
                              Current Plan
                            </Button>
                            {plan.name !== "free" && (
                              <div style={{ marginTop: "1rem" }}>
                                <Button
                                  onClick={handleCancelAction}
                                  tone="critical"
                                  size="large"
                                  fullWidth
                                >
                                  Cancel Subscription
                                </Button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <Button
                            onClick={() => handlePlanAction(plan.name)}
                            variant={plan.recommended ? "primary" : "secondary"}
                            size="large"
                            fullWidth
                            disabled={plan.name === "free" && !canDowngrade}
                          >
                            {plan.name === "free" 
                              ? (canDowngrade ? "Downgrade to Free" : "Free Plan") 
                              : `Upgrade to ${plan.displayName}`
                            }
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>
                </Grid.Cell>
              );
            })}
          </Grid>
        </Layout.Section>

        {/* Billing information */}
        <Layout.Section>
          <Card>
            <div style={{ padding: "1.5rem" }}>
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">💳 Billing Information</Text>
                <div style={{ display: "grid", gap: "0.5rem" }}>
                  <Text as="p" variant="bodySm">
                    • Billing is handled securely through Shopify
                  </Text>
                  <Text as="p" variant="bodySm">
                    • You can upgrade, downgrade, or cancel anytime
                  </Text>
                  <Text as="p" variant="bodySm">
                    • Usage quotas reset on your billing anniversary
                  </Text>
                  <Text as="p" variant="bodySm">
                    • {process.env.NODE_ENV !== "production" ? "Test mode" : "Live billing"} - charges will {process.env.NODE_ENV !== "production" ? "not" : ""} appear on your Shopify bill
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