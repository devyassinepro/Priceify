// app/routes/dev.testing.tsx - Development testing dashboard
import { json, LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useActionData, Form } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { 
  Card, 
  Layout, 
  Page, 
  Button, 
  ButtonGroup, 
  Banner, 
  Text,
  Select,
  Badge,
  DataTable,
  BlockStack,
  InlineStack,
} from "@shopify/polaris";
import { 
  getOrCreateSubscription,
  updateSubscription,
  resetUsage,
  trackProductModifications,
  getUsageStatistics 
} from "../models/subscription.server";
import { PLANS } from "../lib/plans";
import { db } from "../db.server";

// Only allow in development
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (process.env.NODE_ENV !== "development") {
    throw new Response("Not Found", { status: 404 });
  }
  
  const { session } = await authenticate.admin(request);
  const subscription = await getOrCreateSubscription(session.shop);
  const stats = await getUsageStatistics(session.shop);
  
  // Get recent pricing history for testing
  const recentHistory = await db.pricingHistory.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: 'desc' },
    take: 10
  });
  
  return json({
    shop: session.shop,
    subscription,
    stats,
    recentHistory,
    availablePlans: Object.values(PLANS)
  });
};

import { 
  setupTestSubscription,
  createTestHistory,
  testUpgradeScenario,
  cleanupTestData,
  simulateProductModifications,
  getTestReport
} from "../lib/subscription-test-helpers";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get("action") as string;
  const planName = formData.get("planName") as string;
  
  try {
    switch (action) {
      case "change_plan":
        const result = await setupTestSubscription(session.shop, {
          planName: planName as keyof typeof PLANS,
          resetUsage: false
        });
        return json({ success: `Changed to ${PLANS[planName as keyof typeof PLANS].displayName} plan` });
        
      case "reset_usage":
        await resetUsage(session.shop);
        return json({ success: "Usage reset to 0" });
        
      case "simulate_usage":
        const count = parseInt(formData.get("usageCount") as string) || 10;
        const simResult = await simulateProductModifications(session.shop, count);
        return json({ success: `Simulated ${count} product modifications (${simResult.success ? 'within limits' : 'exceeded limits'})` });
        
      case "near_limit":
        await setupTestSubscription(session.shop, {
          planName: 'free',
          simulateNearLimit: true
        });
        return json({ success: "Set usage near limit (85%)" });
        
      case "over_limit":
        await setupTestSubscription(session.shop, {
          planName: 'free',
          simulateOverLimit: true
        });
        return json({ success: "Set usage over limit" });
        
      case "test_upgrade":
        const upgradeResult = await testUpgradeScenario(session.shop, 'free', 'standard');
        return json({ success: `Tested upgrade scenario: Free → Standard` });
        
      case "add_test_history":
        await createTestHistory(session.shop, 10);
        return json({ success: "Added 10 test history entries" });
        
      case "clear_data":
        await cleanupTestData(session.shop);
        return json({ success: "Cleared all test data" });
        
      case "full_report":
        const report = await getTestReport(session.shop);
        return json({ success: "Generated test report", report });
        
      default:
        return json({ error: "Unknown action" });
    }
  } catch (error: any) {
    console.error("🧪 Test action failed:", error);
    return json({ error: error.message });
  }
};

export default function DevTesting() {
  const { shop, subscription, stats, recentHistory, availablePlans } = useLoaderData<typeof loader>();
  const actionData = useActionData<any>();
  
  const historyRows = recentHistory.map((entry: any) => [
    entry.productTitle,
    entry.actionType,
    `$${entry.oldPrice} → $${entry.newPrice}`,
    new Date(entry.createdAt).toLocaleString()
  ]);
  
  return (
    <Page title="🧪 Development Testing Dashboard" subtitle={`Testing environment for ${shop}`}>
      <Layout>
        {actionData?.success && (
          <Layout.Section>
            <Banner tone="success" title="Test Action Completed">
              <Text as="p">{actionData.success}</Text>
            </Banner>
          </Layout.Section>
        )}
        
        {actionData?.error && (
          <Layout.Section>
            <Banner tone="critical" title="Test Action Failed">
              <Text as="p">{actionData.error}</Text>
            </Banner>
          </Layout.Section>
        )}

        {/* Current Subscription Status */}
        <Layout.Section>
          <Card>
            <div style={{ padding: "1.5rem" }}>
              <BlockStack gap="400">
                <Text as="h2" variant="headingLg">📊 Current Subscription Status</Text>
                
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
                  <div>
                    <Text as="p" variant="headingMd">{subscription.planName.toUpperCase()}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Current Plan</Text>
                  </div>
                  
                  <div>
                    <Text as="p" variant="headingMd">{subscription.usageCount} / {subscription.usageLimit}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Products Modified</Text>
                  </div>
                  
                  <div>
                    <Text as="p" variant="headingMd">{stats.currentPeriodStats.totalPriceChanges}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Total Price Changes</Text>
                  </div>
                  
                  <div>
                    <Text as="p" variant="headingMd">{((subscription.usageCount / subscription.usageLimit) * 100).toFixed(1)}%</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Usage Percentage</Text>
                  </div>
                </div>
              </BlockStack>
            </div>
          </Card>
        </Layout.Section>

        {/* Quick Test Actions */}
        <Layout.Section>
          <Card>
            <div style={{ padding: "1.5rem" }}>
              <BlockStack gap="400">
                <Text as="h2" variant="headingLg">🎛️ Quick Test Actions</Text>
                
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "1rem" }}>
                  {/* Plan Testing */}
                  <div>
                    <Text as="h3" variant="headingMd">Change Plan</Text>
                    <Form method="post">
                      <input type="hidden" name="action" value="change_plan" />
                      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                        <Select
                          label=""
                          labelHidden
                          name="planName"
                          options={availablePlans.map(plan => ({
                            label: `${plan.displayName} (${plan.usageLimit} products)`,
                            value: plan.name
                          }))}
                          value="free"
                        />
                        <Button submit variant="primary">Change</Button>
                      </div>
                    </Form>
                  </div>
                  
                  {/* Usage Testing */}
                  <div>
                    <Text as="h3" variant="headingMd">Simulate Usage</Text>
                    <Form method="post">
                      <input type="hidden" name="action" value="simulate_usage" />
                      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                        <Select
                          label=""
                          labelHidden
                          name="usageCount"
                          options={[
                            { label: "5 products", value: "5" },
                            { label: "10 products", value: "10" },
                            { label: "25 products", value: "25" },
                            { label: "50 products", value: "50" },
                          ]}
                          value="10"
                        />
                        <Button submit variant="primary">Simulate</Button>
                      </div>
                    </Form>
                  </div>
                </div>
                
                {/* Reset & Test Actions */}
                <InlineStack gap="200" wrap>
                  <Form method="post">
                    <input type="hidden" name="action" value="reset_usage" />
                    <Button submit>🔄 Reset Usage</Button>
                  </Form>
                  
                  <Form method="post">
                    <input type="hidden" name="action" value="near_limit" />
                    <Button submit>⚠️ Set Near Limit</Button>
                  </Form>
                  
                  <Form method="post">
                    <input type="hidden" name="action" value="over_limit" />
                    <Button submit>🚨 Set Over Limit</Button>
                  </Form>
                  
                  <Form method="post">
                    <input type="hidden" name="action" value="test_upgrade" />
                    <Button submit>🚀 Test Upgrade</Button>
                  </Form>
                  
                  <Form method="post">
                    <input type="hidden" name="action" value="add_test_history" />
                    <Button submit>📝 Add Test History</Button>
                  </Form>
                  
                  <Form method="post">
                    <input type="hidden" name="action" value="full_report" />
                    <Button submit>📊 Full Report</Button>
                  </Form>
                  
                  <Form method="post">
                    <input type="hidden" name="action" value="clear_data" />
                    <Button submit tone="critical">🗑️ Clear All Data</Button>
                  </Form>
                </InlineStack>
              </BlockStack>
            </div>
          </Card>
        </Layout.Section>

        {/* Test History */}
        {recentHistory.length > 0 && (
          <Layout.Section>
            <Card>
              <div style={{ padding: "1rem" }}>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">📋 Recent Test History</Text>
                  
                  <DataTable
                    columnContentTypes={['text', 'text', 'text', 'text']}
                    headings={['Product', 'Action', 'Price Change', 'Date']}
                    rows={historyRows}
                    footerContent={`Showing ${recentHistory.length} recent entries`}
                  />
                </BlockStack>
              </div>
            </Card>
          </Layout.Section>
        )}

        {/* Testing Scenarios */}
        <Layout.Section>
          <Card>
            <div style={{ padding: "1.5rem", backgroundColor: "#f8f9fa" }}>
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">🧪 Testing Scenarios</Text>
                
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "1rem" }}>
                  <div>
                    <Text as="h4" variant="headingMd">Free Plan Limits</Text>
                    <Text as="p" variant="bodySm">
                      1. Simulate 18-20 products<br/>
                      2. Try to modify more<br/>
                      3. Check upgrade prompts
                    </Text>
                  </div>
                  
                  <div>
                    <Text as="h4" variant="headingMd">Plan Upgrades</Text>
                    <Text as="p" variant="bodySm">
                      1. Change to Standard plan<br/>
                      2. Verify new limits work<br/>
                      3. Test quota warnings
                    </Text>
                  </div>
                  
                  <div>
                    <Text as="h4" variant="headingMd">Usage Tracking</Text>
                    <Text as="p" variant="bodySm">
                      1. Modify same product multiple times<br/>
                      2. Verify it counts as 1<br/>
                      3. Check history accuracy
                    </Text>
                  </div>
                </div>
              </BlockStack>
            </div>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}