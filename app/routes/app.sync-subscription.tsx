// app/routes/app.sync-subscription.tsx
import { json, LoaderFunctionArgs, ActionFunctionArgs, redirect } from "@remix-run/node";
import { useLoaderData, useActionData, Link } from "@remix-run/react";
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
  Badge,
  DataTable,
  BlockStack,
  ButtonGroup,
} from "@shopify/polaris";

interface SyncResult {
  success: boolean;
  message: string;
  syncedPlan?: string;
  error?: string;
  details?: any;
}

interface ShopifySubscription {
  id: string;
  name: string;
  status: string;
  currentPeriodEnd?: string;
  lineItems: Array<{
    plan: {
      pricingDetails: {
        price: {
          amount: string;
          currencyCode: string;
        };
        interval: string;
      };
    };
  }>;
}

interface LoaderData {
  shop: string;
  localSubscription: any;
  shopifySubscriptions: ShopifySubscription[];
  plans: typeof PLANS;
  error?: string;
}

export const loader = async ({ request }: LoaderFunctionArgs): Promise<Response> => {
  const { admin, session } = await authenticate.admin(request);
  
  try {
    const localSubscription = await getOrCreateSubscription(session.shop);
    
    // Récupérer les abonnements actifs depuis Shopify
    const response = await admin.graphql(`
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
                      interval
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
    const shopifySubscriptions = data.data?.app?.installation?.activeSubscriptions || [];
    
    return json<LoaderData>({
      shop: session.shop,
      localSubscription,
      shopifySubscriptions,
      plans: PLANS,
    });
    
  } catch (error: any) {
    console.error("Sync loader error:", error);
    return json<LoaderData>({
      shop: session.shop,
      localSubscription: null,
      shopifySubscriptions: [],
      plans: PLANS,
      error: error.message,
    });
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  
  try {
    console.log(`🔄 Starting subscription sync for ${session.shop}...`);
    
    // Récupérer les abonnements Shopify
    const response = await admin.graphql(`
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
    
    const data = await response.json();
    const activeSubscriptions = data.data?.app?.installation?.activeSubscriptions || [];
    
    console.log(`📊 Found ${activeSubscriptions.length} active Shopify subscription(s)`);
    
    if (activeSubscriptions.length === 0) {
      // Aucun abonnement actif -> Plan gratuit
      await updateSubscription(session.shop, {
        planName: "free",
        status: "active",
        usageLimit: PLANS.free.usageLimit,
        subscriptionId: undefined,
      });
      
      return redirect("/app?sync=success&plan=free&message=No active subscription found");
    }
    
    // Prendre le premier abonnement actif
    const subscription = activeSubscriptions[0];
    const amount = parseFloat(subscription.lineItems?.[0]?.plan?.pricingDetails?.price?.amount || "0");
    
    console.log(`💰 Subscription amount: $${amount}`);
    
    // Mapper le montant au plan correspondant
    let detectedPlan = "free";
    for (const [planKey, planData] of Object.entries(PLANS)) {
      if (Math.abs(planData.price - amount) < 0.02) { // Tolérance de 2 centimes
        detectedPlan = planKey;
        break;
      }
    }
    
    console.log(`📋 Detected plan: ${detectedPlan}`);
    
    // Mettre à jour l'abonnement local
    await updateSubscription(session.shop, {
      planName: detectedPlan,
      status: subscription.status.toLowerCase(),
      usageLimit: PLANS[detectedPlan as keyof typeof PLANS].usageLimit,
      subscriptionId: subscription.id,
      currentPeriodEnd: subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : undefined,
    });
    
    console.log(`✅ Subscription synced successfully to ${detectedPlan} plan`);
    
    return redirect(`/app?sync=success&plan=${detectedPlan}&message=Subscription synced successfully`);
    
  } catch (error: any) {
    console.error(`💥 Sync failed:`, error);
    return redirect(`/app?sync=error&message=${encodeURIComponent(error.message)}`);
  }
};

export default function SyncSubscription() {
  const data = useLoaderData<LoaderData>();
  const actionData = useActionData<SyncResult>();
  
  const { shop, localSubscription, shopifySubscriptions, plans, error } = data;
  
  if (error) {
    return (
      <Page title="❌ Sync Error" backAction={{ content: "← Dashboard", url: "/app" }}>
        <Layout>
          <Layout.Section>
            <Banner title="Error Loading Subscription Data" tone="critical">
              <Text as="p">{error}</Text>
            </Banner>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }
  
  const hasActiveShopifySubscription = shopifySubscriptions.length > 0;
  const isOutOfSync = () => {
    if (!localSubscription || !hasActiveShopifySubscription) return true;
    
    if (!hasActiveShopifySubscription && localSubscription.planName !== "free") {
      return true;
    }
    
    if (hasActiveShopifySubscription) {
      const subscription = shopifySubscriptions[0];
      const amount = parseFloat(subscription.lineItems?.[0]?.plan?.pricingDetails?.price?.amount || "0");
      
      // Trouver le plan correspondant
      let expectedPlan = "free";
      for (const [planKey, planData] of Object.entries(plans)) {
        if (Math.abs(planData.price - amount) < 0.02) {
          expectedPlan = planKey;
          break;
        }
      }
      
      return localSubscription.planName !== expectedPlan;
    }
    
    return false;
  };
  
  const needsSync = isOutOfSync();
  
  return (
    <Page 
      title="🔄 Sync Subscription" 
      subtitle="Synchronize your local subscription with Shopify billing"
      backAction={{ content: "← Dashboard", url: "/app" }}
    >
      <Layout>
        {/* Status Overview */}
        <Layout.Section>
          <Card>
            <div style={{ padding: "1.5rem" }}>
              <BlockStack gap="400">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Text as="h2" variant="headingLg">Sync Status</Text>
                  <Badge tone={needsSync ? "critical" : "success"}>
                    {needsSync ? "⚠️ Out of Sync" : "✅ Synchronized"}
                  </Badge>
                </div>
                
                {needsSync && (
                  <Banner title="Synchronization Needed" tone="warning">
                    <Text as="p">
                      Your local subscription data doesn't match your Shopify billing. 
                      Click the sync button below to update.
                    </Text>
                  </Banner>
                )}
              </BlockStack>
            </div>
          </Card>
        </Layout.Section>

        {/* Local Subscription Status */}
        <Layout.Section>
          <Card>
            <div style={{ padding: "1.5rem" }}>
              <BlockStack gap="400">
                <Text as="h2" variant="headingLg">💾 Local Database</Text>
                
                {localSubscription ? (
                  <DataTable
                    columnContentTypes={['text', 'text']}
                    headings={['Property', 'Value']}
                    rows={[
                      ['Plan', localSubscription.planName.toUpperCase()],
                      ['Status', localSubscription.status],
                      ['Usage', `${localSubscription.usageCount} / ${localSubscription.usageLimit}`],
                      ['Shopify ID', localSubscription.subscriptionId || 'None'],
                      ['Expected Price', `$${plans[localSubscription.planName as keyof typeof plans]?.price || 0}/month`],
                      ['Last Updated', new Date(localSubscription.updatedAt).toLocaleString()],
                    ]}
                  />
                ) : (
                  <Text as="p" tone="critical">No local subscription found</Text>
                )}
              </BlockStack>
            </div>
          </Card>
        </Layout.Section>

        {/* Shopify Billing Status */}
        <Layout.Section>
          <Card>
            <div style={{ padding: "1.5rem" }}>
              <BlockStack gap="400">
                <Text as="h2" variant="headingLg">🏪 Shopify Billing</Text>
                
                {hasActiveShopifySubscription ? (
                  <DataTable
                    columnContentTypes={['text', 'text', 'text', 'text']}
                    headings={['Subscription ID', 'Status', 'Amount', 'Period End']}
                    rows={shopifySubscriptions.map((sub: ShopifySubscription) => [
                      sub.id.split('/').pop() || 'Unknown',
                      sub.status,
                      `${sub.lineItems?.[0]?.plan?.pricingDetails?.price?.amount || '0'} ${sub.lineItems?.[0]?.plan?.pricingDetails?.price?.currencyCode || 'USD'}`,
                      sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toLocaleDateString() : 'N/A'
                    ])}
                  />
                ) : (
                  <div>
                    <Text as="p" tone="subdued">No active Shopify subscriptions found</Text>
                    <Text as="p" variant="bodySm">This means you're on the free plan</Text>
                  </div>
                )}
              </BlockStack>
            </div>
          </Card>
        </Layout.Section>

        {/* Actions */}
        <Layout.Section>
          <Card>
            <div style={{ padding: "1.5rem" }}>
              <BlockStack gap="400">
                <Text as="h2" variant="headingLg">🔧 Actions</Text>
                
                <ButtonGroup>
                  <form method="post">
                    <Button 
                      submit 
                      variant={needsSync ? "primary" : "secondary"}
                      size="large"
                    >
                      {needsSync ? "🔄 Sync Now" : "↻ Re-sync"}
                    </Button>
                  </form>
                  
                  <Link to="/app/status">
                    <Button>
                      🔍 View Detailed Status
                    </Button>
                  </Link>
                  
                  <Link to="/app/plans">
                    <Button>
                      💳 Manage Plans
                    </Button>
                  </Link>
                  
                  <Link to="/app">
                    <Button>
                      🏠 Back to Dashboard
                    </Button>
                  </Link>
                </ButtonGroup>
                
                <div style={{ 
                  padding: "1rem", 
                  backgroundColor: "#f8f9fa", 
                  borderRadius: "8px",
                  border: "1px solid #e1e3e5"
                }}>
                  <Text as="h4" variant="headingMd">ℹ️ How Sync Works</Text>
                  <ul style={{ margin: "0.5rem 0", paddingLeft: "1.5rem" }}>
                    <li><Text as="span" variant="bodySm">Fetches your active Shopify subscriptions</Text></li>
                    <li><Text as="span" variant="bodySm">Maps billing amounts to our plan structure</Text></li>
                    <li><Text as="span" variant="bodySm">Updates local database with correct plan and limits</Text></li>
                    <li><Text as="span" variant="bodySm">Preserves your usage history and settings</Text></li>
                  </ul>
                </div>
              </BlockStack>
            </div>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}