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

    // ✅ ALTERNATIVE: Utiliser AppRecurringApplicationCharge (plus compatible)
    const response = await admin.graphql(`
      mutation appRecurringApplicationChargeCreate($name: String!, $price: MoneyInput!, $returnUrl: URL!, $test: Boolean!) {
        appRecurringApplicationChargeCreate(name: $name, price: $price, returnUrl: $returnUrl, test: $test) {
          appRecurringApplicationCharge {
            id
            name
            price {
              amount
              currencyCode
            }
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
        name: `${plan.displayName} Plan - $${plan.price}/month`,
        price: {
          amount: plan.price,
          currencyCode: "USD"
        },
        returnUrl: `https://pricebooster-app-hkfq8.ondigitalocean.app/app?billing_completed=1&sync_needed=1&plan=${selectedPlan}`,
        test: true // Mode test pour éviter les vraies charges
      }
    });

    const result = await response.json();
    console.log('📊 GraphQL Response:', JSON.stringify(result, null, 2));

    if (result.data?.appRecurringApplicationChargeCreate?.userErrors?.length > 0) {
      const errors = result.data.appRecurringApplicationChargeCreate.userErrors;
      console.error('❌ Charge creation errors:', errors);
      return json<ActionResult>({
        error: `Billing error: ${errors.map((e: any) => e.message).join(', ')}`
      });
    }

    const confirmationUrl = result.data?.appRecurringApplicationChargeCreate?.confirmationUrl;
    const chargeId = result.data?.appRecurringApplicationChargeCreate?.appRecurringApplicationCharge?.id;

    if (!confirmationUrl) {
      return json<ActionResult>({
        error: "Failed to create charge - no confirmation URL"
      });
    }

    console.log(`✅ Billing charge created successfully`);
    console.log(`🔗 Confirmation URL: ${confirmationUrl}`);
    console.log(`🆔 Charge ID: ${chargeId}`);

    // Store the charge ID for future reference
    if (chargeId) {
      await updateSubscription(session.shop, {
        subscriptionId: chargeId,
      });
    }

    return json<ActionResult>({
      success: "Redirecting to billing...",
      confirmationUrl
    });

  } catch (error: any) {
    console.error(`💥 Billing creation failed:`, error);
    return json<ActionResult>({
      error: `Failed to create charge: ${error.message}`
    });
  }
};

export default function BillingAlternative() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionResult>();
  const submit = useSubmit();

  const { shop, subscription, plans } = loaderData;

  // Redirect to Shopify billing confirmation page
  React.useEffect(() => {
    if (actionData?.confirmationUrl) {
      console.log('🔗 Redirecting to:', actionData.confirmationUrl);
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
    <Page title="Choose Your Plan (Alternative)" backAction={{ content: "← Dashboard", url: "/app" }}>
      <Layout>
        {/* Action feedback banners */}
        {actionData?.error && (
          <Layout.Section>
            <Banner title="Billing Error" tone="critical">
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

        {/* Information sur l'alternative */}
        <Layout.Section>
          <Banner title="ℹ️ Alternative Billing Method" tone="info">
            <Text as="p">
              Using AppRecurringApplicationCharge instead of AppSubscriptions for better compatibility.
              This method works more reliably during development and testing phases.
            </Text>
          </Banner>
        </Layout.Section>

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
                              : `Try ${plan.displayName}`
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
                    • Using AppRecurringApplicationCharge for maximum compatibility
                  </Text>
                  <Text as="p" variant="bodySm">
                    • Test mode enabled - no real charges will occur
                  </Text>
                  <Text as="p" variant="bodySm">
                    • You can upgrade, downgrade, or cancel anytime
                  </Text>
                  <Text as="p" variant="bodySm">
                    • Usage quotas reset monthly
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