// app/routes/app.billing.tsx - FIX: Only the return URL to prevent login redirect
import React from "react";
import { json, LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useActionData, useSubmit } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { Card, Layout, Page, Text, Button, Grid, Badge, List, Banner, BlockStack } from "@shopify/polaris";
import { getOrCreateSubscription, updateSubscription } from "../models/subscription.server";
import { PLANS, formatPriceDisplay, isEligibleForTrial, getPriceWithTrial } from "../lib/plans";

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

    console.log(`🔄 Billing action: ${actionType} for plan: ${selectedPlan}`);

    if (!selectedPlan || typeof selectedPlan !== "string") {
      return json<ActionResult>({ error: "Invalid plan selected" });
    }

    // Handle downgrade to free plan
    if (actionType === "cancel" || selectedPlan === "free") {
      console.log(`🚫 Processing downgrade to free plan for ${session.shop}`);
      
      try {
        const currentSubscription = await getOrCreateSubscription(session.shop);
        
        // Attempt to cancel Shopify subscription if exists
        if (currentSubscription.subscriptionId) {
          try {
            const cancelResponse = await admin.graphql(`
              mutation AppSubscriptionCancel($id: ID!) {
                appSubscriptionCancel(id: $id) {
                  appSubscription {
                    id
                    status
                  }
                  userErrors {
                    field
                    message
                  }
                }
              }
            `, {
              variables: { id: currentSubscription.subscriptionId }
            });

            const cancelResult = await cancelResponse.json();
            
            if (cancelResult.data?.appSubscriptionCancel?.userErrors?.length > 0) {
              console.log("⚠️ Shopify cancellation had errors:", cancelResult.data.appSubscriptionCancel.userErrors);
            }
          } catch (shopifyError) {
            console.log("⚠️ Could not cancel Shopify subscription:", shopifyError);
          }
        }

        // Always update local subscription to free
        await updateSubscription(session.shop, {
          planName: "free",
          status: "active",
          usageLimit: PLANS.free.usageLimit,
          subscriptionId: undefined,
          currentPeriodEnd: undefined,
        });

        console.log(`✅ Successfully downgraded ${session.shop} to free plan`);
        return json<ActionResult>({ 
          success: "Successfully downgraded to free plan. You can continue using the app with free tier limits."
        });
        
      } catch (error: any) {
        console.error(`❌ Error during downgrade:`, error);
        return json<ActionResult>({ 
          error: `Failed to downgrade: ${error.message}. Please contact support if this issue persists.`
        });
      }
    }

    // Validate plan exists for upgrades
    if (!PLANS[selectedPlan]) {
      return json<ActionResult>({ error: "Plan not found" });
    }

    const plan = PLANS[selectedPlan];

    // ✅ FIX: Proper embedded app return URL that prevents login redirect
    const shopDomain = session.shop;
    const host = Buffer.from(`${shopDomain}/admin`).toString('base64');
    
    // Use Shopify's embedded app return URL format
    const returnUrl = `https://${shopDomain}/admin/apps/${process.env.SHOPIFY_API_KEY}?host=${host}&billing_success=1&plan=${selectedPlan}`;
    
    console.log(`🔗 Return URL: ${returnUrl}`);
    
    // Check trial eligibility  
    const subscription = await getOrCreateSubscription(session.shop);
    const trialEligible = isEligibleForTrial(subscription, selectedPlan);
    
    // Build GraphQL variables
    const variables: any = {
      name: `${plan.displayName} Plan`,
      returnUrl,
      test: process.env.NODE_ENV !== "production",
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
    };

    // Add trial if eligible
    if (trialEligible && plan.trialDays && plan.trialDays > 0) {
      variables.lineItems[0].plan.appRecurringPricingDetails.trialDays = plan.trialDays;
      console.log(`🎁 Adding ${plan.trialDays} trial days`);
    }
    
    console.log(`🔄 Creating Shopify subscription for ${plan.displayName}`);
    
    // Create Shopify subscription
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
    `, { variables });

    const result = await response.json();

    if (result.data?.appSubscriptionCreate?.userErrors?.length > 0) {
      const errors = result.data.appSubscriptionCreate.userErrors;
      console.error('Subscription creation errors:', errors);
      return json<ActionResult>({
        error: `Unable to process upgrade: ${errors.map((e: any) => e.message).join(', ')}. Please try again or contact support.`
      });
    }

    const confirmationUrl = result.data?.appSubscriptionCreate?.confirmationUrl;
    const subscriptionId = result.data?.appSubscriptionCreate?.appSubscription?.id;

    if (!confirmationUrl) {
      return json<ActionResult>({
        error: "Unable to create billing session. Please try again or contact support."
      });
    }

    // Store subscription ID for reference
    if (subscriptionId) {
      await updateSubscription(session.shop, {
        subscriptionId: subscriptionId,
        // Don't change plan here - wait for successful payment
      });
    }

    console.log(`✅ Subscription created - redirecting to Shopify billing`);

    return json<ActionResult>({
      success: "Redirecting to secure billing...",
      confirmationUrl
    });

  } catch (error: any) {
    console.error(`💥 Billing action failed:`, error);
    return json<ActionResult>({
      error: `System error occurred. Please try again in a few moments or contact support if the issue persists.`
    });
  }
};

export default function Billing() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionResult>();
  const submit = useSubmit();

  const { shop, subscription, plans } = loaderData;

  // Redirect to Shopify billing
  React.useEffect(() => {
    if (actionData?.confirmationUrl) {
      console.log('🔗 Redirecting to Shopify billing:', actionData.confirmationUrl);
      // Use top-level navigation for embedded apps
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
    const currentPlan = subscription.planName;
    const isCurrentlyFree = currentPlan === "free";
    
    if (isCurrentlyFree) {
      alert("You're already on the free plan!");
      return;
    }

    const actionText = currentPlan === "free" ? "cancel" : "downgrade to the free plan";
    const confirmMessage = `Are you sure you want to ${actionText}? You'll lose access to premium features and your usage will be limited to 20 products per month.`;
    
    if (confirm(confirmMessage)) {
      const formData = new FormData();
      formData.append("plan", currentPlan);
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
              <div style={{ marginTop: "1rem" }}>
                <Text as="p" variant="bodySm">
                  If the issue persists, try the manual sync option or contact support.
                </Text>
              </div>
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
              <div style={{ marginTop: "1rem" }}>
                <Text as="p" variant="bodySm">
                  After payment, you'll be automatically redirected back to the app with your new plan activated.
                </Text>
              </div>
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
                      {subscription.usageCount} / {subscription.usageLimit === 9999999 ? "unlimited" : subscription.usageLimit} products used this month
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
              const trialEligible = isEligibleForTrial(subscription, plan.name);
              const priceDisplay = getPriceWithTrial(plan, trialEligible);
              
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
                          {trialEligible && priceDisplay.trialInfo && (
                            <div style={{ marginTop: "0.5rem" }}>
                              🎁 {priceDisplay.trialInfo}
                            </div>
                          )}
                        </div>

                        <div style={{ marginBottom: "2rem" }}>
                          <Text as="p" variant="headingXl" fontWeight="bold">
                            {priceDisplay.displayPrice}
                          </Text>
                          {trialEligible && priceDisplay.trialInfo && (
                            <Text as="p" variant="bodySm" tone="subdued">
                              {priceDisplay.trialInfo}, then {formatPriceDisplay(plan.price)}
                            </Text>
                          )}
                        </div>

                        <div style={{ marginBottom: "2rem" }}>
                          <Text as="p" variant="bodyLg" fontWeight="semibold">
                            {plan.usageLimit === 9999999 ? "Unlimited" : plan.usageLimit} products/month
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
                            disabled={plan.name === "free"} // Disable free plan button - use cancel instead
                          >
                            {plan.name === "free" 
                              ? "Free Plan" 
                              : `${trialEligible && priceDisplay.trialInfo ? "Start Free Trial" : `Upgrade to ${plan.displayName}`}`
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

        {/* Billing information and troubleshooting */}
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
                    • Free trials are available for new users on paid plans
                  </Text>
                  <Text as="p" variant="bodySm">
                    • Downgrading to free is immediate and cancels billing
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