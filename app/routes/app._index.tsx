import { json, LoaderFunctionArgs, redirect } from "@remix-run/node";
import { useLoaderData, Link, useSearchParams } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { updateSubscription } from "../models/subscription.server";
import { PLANS } from "../lib/plans";
import {
  Card,
  Layout,
  Page,
  Text,
  Button,
  ButtonGroup,
  Banner,
  Grid,
  ProgressBar,
  Badge,
  Icon,
  BlockStack,
  InlineStack,
} from "@shopify/polaris";
import {
  PriceListIcon,
  ChartVerticalIcon,
  CheckCircleIcon,
  PlanIcon,
} from "@shopify/polaris-icons";
import { getSubscriptionStats } from "../models/subscription.server";
import { getPlan, formatPriceDisplay } from "../lib/plans";
import { useEffect } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const planParam = url.searchParams.get("plan");
  const charge_id = url.searchParams.get("charge_id");
  
  console.log(`🔄 Billing callback received for shop: ${shop}, plan: ${planParam}`);
  console.log(`🔗 Full callback URL: ${url.toString()}`);
  
  // Check required parameters
  if (!shop) {
    console.error(`❌ No shop parameter in callback URL`);
    return redirect("/auth/login?error=missing_shop");
  }

   // Check required parameters
   if (!shop) {
    console.error(`❌ No shop parameter in callback URL`);
    return redirect("/auth/login?error=missing_shop");
  }
  
  try {
    // Try to authenticate with the request
    const { admin, session } = await authenticate.admin(request);
    
    console.log(`✅ Authentication successful for ${session.shop}`);
    
    // Verify shop matches
    if (session.shop !== shop) {
      console.error(`❌ Shop mismatch: session=${session.shop}, callback=${shop}`);
      return redirect(`/auth/login?shop=${shop}`);
    }
    
    // Get active subscriptions from Shopify to verify the payment
    const response = await admin.graphql(`
      query GetActiveSubscriptions {
        app {
          installation {
            activeSubscriptions {
              id
              name
              status
              currentPeriodEnd
              createdAt
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

    const data = await response.json();
    const activeSubscriptions = data.data?.app?.installation?.activeSubscriptions || [];
    
    console.log(`📊 Found ${activeSubscriptions.length} active subscriptions`);
    
    if (activeSubscriptions.length === 0) {
      console.error(`❌ No active subscriptions found after payment`);
      return redirect("/app?error=no_subscription_found");
    }
    
    // Get the most recent subscription
    const latestSubscription = activeSubscriptions.sort((a: any, b: any) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )[0];
    
    if (latestSubscription.status !== "ACTIVE") {
      console.log(`⚠️ Subscription status: ${latestSubscription.status}`);
      return redirect("/app?error=subscription_not_active");
    }
    
    const amount = latestSubscription.lineItems?.[0]?.plan?.pricingDetails?.price?.amount;
    const subscriptionId = latestSubscription.id.split('/').pop();
    
    console.log(`💰 Processing subscription: ${subscriptionId}, amount: ${amount}`);
    
    // Determine plan based on price
    let planName = planParam || "free";
    if (amount) {
      const priceFloat = parseFloat(amount);
      for (const [key, plan] of Object.entries(PLANS)) {
        if (Math.abs(plan.price - priceFloat) < 0.02) {
          planName = key;
          console.log(`✅ Matched plan: ${planName} for price $${priceFloat}`);
          break;
        }
      }
    }
    
    // Update local subscription
    await updateSubscription(session.shop, {
      planName,
      status: "active",
      subscriptionId,
      usageLimit: PLANS[planName].usageLimit,
      currentPeriodEnd: latestSubscription.currentPeriodEnd ? 
        new Date(latestSubscription.currentPeriodEnd) : 
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    
    console.log(`✅ Subscription updated successfully: ${planName}`);
    
    // Redirect to app with success parameters
    return redirect(`/app?sync=success&plan=${planName}&upgraded=true`);
    
  } catch (authError: any) {
    console.log(`⚠️ Admin auth failed, trying alternative approach:`, authError.message);
    
    // If authentication fails, try to handle it gracefully
    if (authError.message?.includes('unauthorized') || authError.message?.includes('login')) {
      // Construct a safe redirect URL back to the app
      const redirectParams = new URLSearchParams();
      redirectParams.set('shop', shop);
      if (planParam) redirectParams.set('plan', planParam);
      if (charge_id) redirectParams.set('charge_id', charge_id);
      redirectParams.set('callback', 'billing');
      
      const safeRedirectUrl = `/app?${redirectParams.toString()}`;
      console.log(`🔄 Redirecting to app for re-authentication: ${safeRedirectUrl}`);
      
      return redirect(safeRedirectUrl);
    }
    
    // For other errors, redirect with error message
    console.error(`💥 Billing callback error:`, authError);
    return redirect(`/app?error=callback_failed&message=${encodeURIComponent(authError.message)}`);
  }
    // ✅ Détection des callbacks de billing
    // const callbackType = url.searchParams.get("callback");
    // const callbackShop = url.searchParams.get("shop");
    // const callbackPlan = url.searchParams.get("plan");

    // if (callbackType === "billing" && callbackShop === session.shop) {
    //   console.log(`🔄 Billing callback detected, triggering sync for plan: ${callbackPlan}`);
    //   return redirect("/app/sync-subscription");
    // }
    
    // // ✅ Détection automatique de retour depuis la page de tarification Shopify
    // const referrer = request.headers.get("referer") || "";
    // const fromShopifyPricing = referrer.includes("/charges/priceboost/pricing_plans") || 
    //                           referrer.includes("shopify.com") && url.searchParams.has("upgraded");
    
    // // Si l'utilisateur vient de la page de tarification Shopify, synchroniser automatiquement
    // if (fromShopifyPricing && !url.searchParams.get("sync")) {
    //   console.log(`🔄 User returned from Shopify pricing page, triggering sync...`);
    //   return redirect("/app/sync-subscription");
    // }
  
    console.log(`✅ Authentication successful for ${session.shop}`);

  // Récupérer les données d'abonnement
  const subscriptionStats = await getSubscriptionStats(session.shop);
  const plan = getPlan(subscriptionStats.planName);

  // Paramètres de synchronisation
  const syncStatus = url.searchParams.get("sync");
  const syncPlan = url.searchParams.get("plan");
  const syncMessage = url.searchParams.get("message");
  
  return json({
    shop: session.shop,
    subscription: subscriptionStats,
    plan,
    usagePercentage: (subscriptionStats.usageCount / subscriptionStats.usageLimit) * 100,
    remainingProducts: subscriptionStats.usageLimit - subscriptionStats.usageCount,
    uniqueProductCount: subscriptionStats.uniqueProductCount || 0,
    syncStatus,
    syncPlan,
    syncMessage,
  });
};

export default function Index() {
  const { 
    shop, 
    subscription, 
    plan, 
    usagePercentage, 
    remainingProducts, 
    uniqueProductCount,
    syncStatus,
    syncPlan,
    syncMessage,
  } = useLoaderData<typeof loader>();
  
  const [searchParams, setSearchParams] = useSearchParams();

  const isNewUser = subscription.usageCount === 0;
  const isNearLimit = usagePercentage > 80;
  const hasReachedLimit = usagePercentage >= 100;

  // ✅ URL de tarification Shopify
  const shopName = shop.replace('.myshopify.com', '');
  const shopifyBillingUrl = `https://admin.shopify.com/store/${shopName}/charges/priceboost/pricing_plans`;

  // Nettoyer les paramètres de sync après 5 secondes
  useEffect(() => {
    if (syncStatus) {
      const timer = setTimeout(() => {
        const params = new URLSearchParams(searchParams);
        params.delete("sync");
        params.delete("plan");
        params.delete("message");
        setSearchParams(params, { replace: true });
      }, 5000);
      
      return () => clearTimeout(timer);
    }
  }, [syncStatus, searchParams, setSearchParams]);

  return (
    <Page title="Dashboard" subtitle={`Welcome back to Dynamic Pricing for ${shop}`}>
      <Layout>
        {/* Bannières de synchronisation */}
        {syncStatus === "success" && (
          <Layout.Section>
            <Banner title="🎉 Subscription Updated!" tone="success">
              <Text as="p">
                Your subscription has been successfully updated to the {syncPlan} plan. 
                You can now modify up to {plan.usageLimit === 99999 ? 'unlimited' : plan.usageLimit} products per month.
              </Text>
            </Banner>
          </Layout.Section>
        )}
        
        {syncStatus === "no_subscription" && (
          <Layout.Section>
            <Banner title="ℹ️ No Active Subscription" tone="info">
              <Text as="p">
                You're currently on the free plan. Visit our pricing page to upgrade and unlock more features.
              </Text>
            </Banner>
          </Layout.Section>
        )}
        
        {syncStatus === "error" && (
          <Layout.Section>
            <Banner title="⚠️ Sync Error" tone="warning">
              <Text as="p">
                There was an issue synchronizing your subscription: {syncMessage}. 
                Please try refreshing the page or contact support if the issue persists.
              </Text>
            </Banner>
          </Layout.Section>
        )}
        
        {syncStatus === "inactive_subscription" && (
          <Layout.Section>
            <Banner title="⏳ Subscription Processing" tone="info">
              <Text as="p">
                Your subscription is being processed. Please check back in a few minutes.
              </Text>
            </Banner>
          </Layout.Section>
        )}

        {/* Avertissements d'utilisation */}
        {isNearLimit && !syncStatus && (
          <Layout.Section>
            <Banner 
              title={hasReachedLimit ? "Product Limit Reached" : "Approaching Product Limit"}
              tone={hasReachedLimit ? "critical" : "warning"}
              action={hasReachedLimit ? {
                content: "View Pricing Plans",
                url: "/app/plans"
              } : {
                content: "View Pricing Plans",
                url: "/app/plans"
              }}
            >
              <Text as="p">
                You've modified {subscription.usageCount} of {subscription.usageLimit} allowed unique products this month
                {hasReachedLimit ? ". Upgrade to continue making changes." : "."}
              </Text>
            </Banner>
          </Layout.Section>
        )}

        {/* Statistiques rapides */}
        <Layout.Section>
          <Grid>
            <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
              <Card>
                <div style={{ padding: "1.5rem", textAlign: "center" }}>
                  <div style={{ marginBottom: "0.5rem" }}>
                    <Icon source={PlanIcon} />
                  </div>
                  <Text as="h3" variant="headingMd">Current Plan</Text>
                  <Text as="p" variant="bodyLg" tone={plan.name === "free" ? "subdued" : "success"}>
                    {plan.displayName}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {formatPriceDisplay(plan.price)}
                  </Text>
                </div>
              </Card>
            </Grid.Cell>

            <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
              <Card>
                <div style={{ padding: "1.5rem", textAlign: "center" }}>
                  <div style={{ marginBottom: "0.5rem" }}>
                    <Icon source={ChartVerticalIcon} />
                  </div>
                  <Text as="h3" variant="headingMd">Products Modified</Text>
                  <Text as="p" variant="bodyLg">
                    {subscription.usageCount} / {subscription.usageLimit}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Unique products this month
                  </Text>
                  <div style={{ marginTop: "0.5rem" }}>
                    <ProgressBar 
                      progress={usagePercentage} 
                      size="small"
                      tone={hasReachedLimit ? "critical" : "primary"}
                    />
                  </div>
                </div>
              </Card>
            </Grid.Cell>

            <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
              <Card>
                <div style={{ padding: "1.5rem", textAlign: "center" }}>
                  <div style={{ marginBottom: "0.5rem" }}>
                    <Icon source={CheckCircleIcon} />
                  </div>
                  <Text as="h3" variant="headingMd">Products Remaining</Text>
                  <Text as="p" variant="bodyLg" tone={remainingProducts > 0 ? "success" : "critical"}>
                    {remainingProducts}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    until {new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString()}
                  </Text>
                </div>
              </Card>
            </Grid.Cell>

            <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
              <Card>
                <div style={{ padding: "1.5rem", textAlign: "center" }}>
                  <div style={{ marginBottom: "0.5rem" }}>
                    <Icon source={PriceListIcon} />
                  </div>
                  <Text as="h3" variant="headingMd">Total Price Changes</Text>
                  <Text as="p" variant="bodyLg">
                    {subscription.totalPriceChanges || 0}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Individual changes made
                  </Text>
                </div>
              </Card>
            </Grid.Cell>
          </Grid>
        </Layout.Section>

        {/* Actions principales */}
        <Layout.Section>
          <Grid>
            <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 8, xl: 8 }}>
              <Card>
                <div style={{ padding: "2rem" }}>
                  <BlockStack gap="400">
                    <div>
                      <Text as="h2" variant="headingLg">Ready to optimize your pricing?</Text>
                      <Text as="p" tone="subdued">
                        Use our intelligent pricing tools to boost your revenue. Modify as many prices as you want per product!
                      </Text>
                    </div>
                    
                    <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                    <Link to="/app/pricing">
                        <Button variant="primary" size="large" disabled={hasReachedLimit}>
                          {hasReachedLimit ? "Upgrade to Continue" : "Update Prices"}
                        </Button>
                      </Link>
                      
                      <Link to="/app/history">
                        <Button size="large">View History</Button>
                      </Link>

                      {plan.name === "free" && (
                        <Link to="/app/plans">
                          <Button size="large" tone="success">
                            🚀 View Pricing Plans
                          </Button>
                        </Link>
                      )}
                    
                      {/* Bouton de synchronisation manuelle */}
                      <Link to="/app/sync-subscription">
                        <Button size="large">
                          🔄 Sync Subscription
                        </Button>
                      </Link>
                    </div>
                  </BlockStack>
                </div>
              </Card>
            </Grid.Cell>
            
            <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
              <Card>
                <div style={{ padding: "1.5rem" }}>
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingMd">How it works</Text>
                    
                    <div>
                      <Text as="p" variant="bodySm">
                        <strong>1. Select</strong> products to modify (counts toward quota)
                      </Text>
                      <Text as="p" variant="bodySm">
                        <strong>2. Choose</strong> adjustment type (%, fixed price, etc.)
                      </Text>
                      <Text as="p" variant="bodySm">
                        <strong>3. Preview</strong> changes before applying
                      </Text>
                      <Text as="p" variant="bodySm">
                        <strong>4. Apply</strong> updates (modify variants freely within each product)
                      </Text>
                      {plan.name === "free" && (
                        <Text as="p" variant="bodySm" tone="subdued">
                          <strong>5. Upgrade</strong> to modify more products per month
                        </Text>
                      )}
                    </div>
                  </BlockStack>
                </div>
              </Card>
            </Grid.Cell>
          </Grid>
        </Layout.Section>

        {/* CTA d'upgrade pour plan gratuit */}
        {plan.name === "free" && !hasReachedLimit && (
          <Layout.Section>
            <Card>
              <div style={{ 
                padding: "2rem", 
                textAlign: "center",
                background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                color: "white",
                borderRadius: "8px"
              }}>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingLg" tone="inherit">
                    Ready to modify more products?
                  </Text>
                  <Text as="p" tone="inherit">
                    Upgrade to Standard (500 products) or Pro (unlimited products) to unlock your pricing potential.
                  </Text>
                  <div>
                        <Link to="/app/plans">
                          <Button size="large" tone="success">
                            🚀 View Pricing Plans
                          </Button>
                        </Link>
                  </div>
                  <Text as="p" variant="bodySm" tone="inherit">
                    ✨ After upgrading, return here and your new plan will be automatically activated!
                  </Text>
                </BlockStack>
              </div>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}