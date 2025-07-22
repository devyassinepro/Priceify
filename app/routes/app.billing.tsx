import { json, LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, Form, useActionData, useNavigation } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { 
  Card, 
  Layout, 
  Page, 
  Button, 
  Banner, 
  Text, 
  Grid, 
  LegacyCard,
  Badge,
  ProgressBar
} from "@shopify/polaris";
import { getSubscriptionStats, updateSubscription } from "../models/subscription.server";
import { PLANS, getPlan, formatPriceDisplay } from "../lib/plans";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  
  const subscriptionStats = await getSubscriptionStats(session.shop);
  
  return json({ 
    subscriptionStats,
    plans: Object.values(PLANS),
    shop: session.shop,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const planName = formData.get("planName") as string;
  
  const selectedPlan = PLANS[planName];
  
  if (!selectedPlan || selectedPlan.name === "free") {
    return json({ error: "Invalid plan selected" });
  }

    // MODE DÉVELOPPEMENT : Simuler l'upgrade sans Shopify Billing API
    if (process.env.NODE_ENV === "development") {
      try {
        // Mettre à jour directement l'abonnement local
        await updateSubscription(session.shop, {
          planName: selectedPlan.name,
          status: "active",
          usageLimit: selectedPlan.usageLimit,
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // +30 jours
        });
        
        return json({ 
          success: true,
          message: `Upgrade simulé vers ${selectedPlan.displayName} réussi !`,
          redirectToApp: true
        });
      } catch (error: any) {
        return json({ 
          error: "Erreur lors de l'upgrade simulé",
          details: error.message 
        });
      }
    }
  
  // MODE PRODUCTION : Utiliser l'API Shopify (nécessite une app publique)
  try {
    const response = await admin.graphql(`
      mutation AppSubscriptionCreate($name: String!, $returnUrl: URL!, $test: Boolean, $lineItems: [AppSubscriptionLineItemInput!]!) {
        appSubscriptionCreate(name: $name, returnUrl: $returnUrl, test: $test, lineItems: $lineItems) {
          appSubscription {
            id
            name
            status
            currentPeriodEnd
            test
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
        name: `Dynofy ${selectedPlan.displayName}`,
        returnUrl: `${process.env.SHOPIFY_APP_URL}/app/billing/callback`,
        test: true, // Toujours en mode test pour le développement
        lineItems: [{
          plan: {
            appRecurringPricingDetails: {
              interval: selectedPlan.billingInterval || "EVERY_30_DAYS",
              price: { 
                amount: selectedPlan.price, 
                currencyCode: selectedPlan.currency
              }
            }
          }
        }]
      }
    });
    
    const data = await response.json();
    
    if (data.data?.appSubscriptionCreate?.userErrors?.length > 0) {
      return json({ 
        error: "Subscription creation failed",
        details: data.data.appSubscriptionCreate.userErrors 
      });
    }
    
    if (data.data?.appSubscriptionCreate?.confirmationUrl) {
      await updateSubscription(session.shop, {
        status: "pending",
        planName: selectedPlan.name,
      });
      
      return json({ 
        confirmationUrl: data.data.appSubscriptionCreate.confirmationUrl 
      });
    }
    
    return json({ error: "Unable to create subscription" });
    
  } catch (error: any) {
    console.error("Billing error:", error);
    return json({ 
      error: "System error during subscription creation",
      details: error.message 
    });
  }
};

export default function Billing() {
  const { subscriptionStats, plans, shop } = useLoaderData<typeof loader>();
  const actionData = useActionData<any>();
  const navigation = useNavigation();
  
  const isLoading = navigation.state === "submitting";
  
  // Redirect to Shopify billing if confirmation URL is provided
  if (actionData?.confirmationUrl && typeof window !== "undefined") {
    // Use top-level redirect for embedded app
    window.parent.location.href = actionData.confirmationUrl;
    return (
      <Page title="Redirecting to Shopify...">
        <Layout>
          <Layout.Section>
            <Card>
              <div style={{ padding: "2rem", textAlign: "center" }}>
                <Text as="p">Redirecting to Shopify billing page...</Text>
              </div>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const getBadgeStatus = (currentPlan: string, planName: string) => {
    if (currentPlan === planName) {
      return <Badge tone="success">Current Plan</Badge>;
    }
    if (planName === "standard" && PLANS[planName].recommended) {
      return <Badge tone="attention">Recommended</Badge>;
    }
    return null;
  };

  const getUpgradeButtonText = (planName: string) => {
    if (subscriptionStats.planName === planName) return "Current Plan";
    if (planName === "free") return "Contact Support";
    return `Upgrade to ${PLANS[planName].displayName}`;
  };

  // Dans le composant, gérez le succès de la simulation
if (actionData?.success && actionData?.redirectToApp) {
  return (
    <Page title="Upgrade Successful!">
      <Layout>
        <Layout.Section>
          <Banner tone="success" title="Upgrade Simulé Réussi !">
            <Text as="p">{actionData.message}</Text>
          </Banner>
          <div style={{ marginTop: "1rem", textAlign: "center" }}>
            <Button variant="primary" url="/app">
              Retour au Dashboard
            </Button>
          </div>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

  return (
    <Page 
      title="💳 Subscription & Billing"
      subtitle={`Manage your Dynofy subscription for ${shop}`}
    >
      <Layout>
        {/* Current subscription status */}
        <Layout.Section>
          <Card>
            <div style={{ padding: "1.5rem" }}>
              <div style={{ 
                display: "flex", 
                justifyContent: "space-between", 
                alignItems: "center" 
              }}>
                <div>
                  <Text as="h2" variant="headingMd">
                    Current Plan: {subscriptionStats.plan.displayName}
                  </Text>
                  <Text as="p" tone="subdued">
                    {formatPriceDisplay(subscriptionStats.plan.price)}
                  </Text>
                </div>
                
                <div style={{ textAlign: "right" }}>
                  <Text as="p" variant="bodySm">
                    Usage: {subscriptionStats.usageCount}/{subscriptionStats.usageLimit}
                  </Text>
                  <div style={{ width: "200px", marginTop: "0.5rem" }}>
                    <ProgressBar 
                      progress={subscriptionStats.usagePercentage} 
                      size="small"
                    />
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </Layout.Section>

        {/* Usage warnings */}
        {subscriptionStats.usagePercentage > 80 && subscriptionStats.planName === 'free' && (
          <Layout.Section>
            <Banner tone="warning" title="Usage Limit Warning">
              <Text as="p">
                You've used {subscriptionStats.usagePercentage.toFixed(1)}% of your monthly quota. 
                Consider upgrading to continue using the app without interruption.
              </Text>
            </Banner>
          </Layout.Section>
        )}

        {subscriptionStats.usagePercentage >= 100 && (
          <Layout.Section>
            <Banner tone="critical" title="Usage Limit Reached">
              <Text as="p">
                You've reached your monthly limit of {subscriptionStats.usageLimit} modifications. 
                Upgrade your plan to continue making price changes.
              </Text>
            </Banner>
          </Layout.Section>
        )}

        {/* Error display */}
        {actionData?.error && (
          <Layout.Section>
            <Banner tone="critical" title="Subscription Error">
              <Text as="p">{actionData.error}</Text>
              {actionData.details && (
                <Text as="p" variant="bodySm">
                  Details: {JSON.stringify(actionData.details)}
                </Text>
              )}
            </Banner>
          </Layout.Section>
        )}
        
        {/* Available plans */}
        <Layout.Section>
          <Text as="h2" variant="headingLg">Choose Your Plan</Text>
          <div style={{ marginTop: "1rem" }}>
            <Grid>
              {plans.map((plan) => (
                <Grid.Cell key={plan.name} columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
                  <LegacyCard>
                    <div style={{ padding: "2rem", position: "relative", height: "100%" }}>
                      {/* Plan badge */}
                      <div style={{ marginBottom: "1rem", minHeight: "24px" }}>
                        {getBadgeStatus(subscriptionStats.planName, plan.name)}
                      </div>
                      
                      {/* Plan name and price */}
                      <div style={{ marginBottom: "1rem" }}>
                        <Text as="h3" variant="headingMd">{plan.displayName}</Text>
                        <Text as="h2" variant="heading2xl">
                          {formatPriceDisplay(plan.price, plan.currency)}
                        </Text>
                      </div>
                      
                      {/* Divider replacement */}
                      <hr style={{ 
                        border: "none", 
                        borderTop: "1px solid #e1e3e5", 
                        margin: "1rem 0" 
                      }} />
                      
                      {/* Features list */}
                      <div style={{ margin: "1rem 0" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                          {plan.features.map((feature, index) => (
                            <Text as="p" key={index} variant="bodySm">
                              ✓ {feature}
                            </Text>
                          ))}
                        </div>
                      </div>
                      
                      {/* Action button */}
                      <div style={{ marginTop: "auto", paddingTop: "1rem" }}>
                        {subscriptionStats.planName === plan.name ? (
                          <Button disabled fullWidth size="large">
                            Current Plan
                          </Button>
                        ) : plan.name === "free" ? (
                          <Button disabled fullWidth size="large">
                            Contact Support to Downgrade
                          </Button>
                        ) : (
                          <Form method="post">
                            <input type="hidden" name="planName" value={plan.name} />
                            <Button 
                              submit 
                              variant="primary" 
                              fullWidth 
                              size="large"
                              loading={isLoading}
                            >
                              {isLoading ? "Processing..." : getUpgradeButtonText(plan.name)}
                            </Button>
                          </Form>
                        )}
                      </div>
                    </div>
                  </LegacyCard>
                </Grid.Cell>
              ))}
            </Grid>
          </div>
        </Layout.Section>

        {/* Billing information */}
        <Layout.Section>
          <Card>
            <div style={{ padding: "1.5rem" }}>
              <Text as="h3" variant="headingMd">Billing Information</Text>
              <div style={{ 
                display: "flex", 
                flexDirection: "column", 
                gap: "0.5rem", 
                marginTop: "1rem" 
              }}>
                <Text as="p">
                  • All prices are in USD and will be converted to your local currency by Shopify
                </Text>
                <Text as="p">
                  • Billing is handled securely through Shopify's billing system
                </Text>
                <Text as="p">
                  • Usage resets monthly on your billing anniversary
                </Text>
                <Text as="p">
                  • Cancel anytime from your Shopify admin under Apps → Manage private apps
                </Text>
                <Text as="p">
                  • Questions? Contact our support team at support@dynofy.com
                </Text>
              </div>
            </div>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}