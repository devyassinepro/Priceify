import { json, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, Link } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { Card, Layout, Page, Text, Button, ButtonGroup, Badge, BlockStack } from "@shopify/polaris";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  
  const testUrls = {
    // 1. Test de la page de retour billing
    billingReturn: `/billing-return?charge_id=12345`,
    billingReturnWithoutCharge: `/billing-return`,
    
    // 2. Test du déclenchement de sync
    triggerSync: `/app?billing_completed=1&sync_needed=1&charge_id=12345`,
    
    // 3. Test de sync manuel
    manualSync: `/app/sync-subscription`,
    
    // 4. Test du dashboard avec différents états
    dashboardSuccess: `/app?sync=success&plan=standard&message=Test%20success`,
    dashboardError: `/app?sync=error&message=Test%20error`,
    
    // 5. Pages de statut
    status: `/app/status`,
    plans: `/app/plans`,
  };
  
  return json({
    shop: session.shop,
    testUrls,
    flowSteps: [
      "User clicks on plan in /app/plans",
      "Shopify billing page opens", 
      "User approves payment",
      "Shopify redirects to /billing-return?charge_id=XXXXX",
      "Beautiful success page shows for 3 seconds",
      "Auto-redirect to /app?billing_completed=1&sync_needed=1",
      "App detects billing_completed=1",
      "Auto-redirect to /app/sync-subscription", 
      "Sync queries Shopify API",
      "Local database updated",
      "Redirect to /app?sync=success&plan=NEW_PLAN",
      "Dashboard shows success banner"
    ]
  });
};

export default function TestFullBillingFlow() {
  const { shop, testUrls, flowSteps } = useLoaderData<typeof loader>();
  
  return (
    <Page title="🧪 Test Full Billing Flow" subtitle={`Complete flow testing for ${shop}`}>
      <Layout>
        <Layout.Section>
          <Card>
            <div style={{ padding: "1.5rem" }}>
              <BlockStack gap="400">
                <div>
                  <Text as="h2" variant="headingLg">✅ Billing System Status</Text>
                  <Badge tone="success">WORKING</Badge>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Shopify correctly redirects to /billing-return?charge_id=XXXXX
                  </Text>
                </div>
                
                <div>
                  <Text as="h3" variant="headingMd">🔄 Complete Flow Steps</Text>
                  <ol style={{ paddingLeft: "1.5rem", margin: "0.5rem 0" }}>
                    {flowSteps.map((step, index) => (
                      <li key={index} style={{ marginBottom: "0.3rem" }}>
                        <Text as="span" variant="bodySm">{step}</Text>
                      </li>
                    ))}
                  </ol>
                </div>
              </BlockStack>
            </div>
          </Card>
        </Layout.Section>

        {/* Test de la page de retour billing */}
        <Layout.Section>
          <Card>
            <div style={{ padding: "1.5rem" }}>
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">🎉 Test Billing Return Page</Text>
                
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "0.5rem" }}>
                  <div>
                    <Link to={testUrls.billingReturn}>
                      <Button fullWidth variant="primary">
                        Test with Charge ID
                      </Button>
                    </Link>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Simulates: /billing-return?charge_id=12345
                    </Text>
                  </div>
                  
                  <div>
                    <Link to={testUrls.billingReturnWithoutCharge}>
                      <Button fullWidth>
                        Test without Charge ID
                      </Button>
                    </Link>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Edge case: /billing-return (no charge_id)
                    </Text>
                  </div>
                </div>
                
                <div style={{ backgroundColor: "#f0f8ff", padding: "1rem", borderRadius: "8px" }}>
                  <Text as="h4" variant="headingMd">Expected Behavior:</Text>
                  <ul style={{ paddingLeft: "1.5rem", margin: "0.5rem 0" }}>
                    <li>Beautiful success page with animations</li>
                    <li>Shows charge ID (if provided)</li>
                    <li>3-step progress animation</li>
                    <li>Auto-redirect after 3 seconds</li>
                    <li>Fallback redirect after 10 seconds</li>
                  </ul>
                </div>
              </BlockStack>
            </div>
          </Card>
        </Layout.Section>

        {/* Test du sync trigger */}
        <Layout.Section>
          <Card>
            <div style={{ padding: "1.5rem" }}>
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">🔄 Test Sync Trigger</Text>
                
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "0.5rem" }}>
                  <div>
                    <Link to={testUrls.triggerSync}>
                      <Button fullWidth variant="primary">
                        Test Auto Sync
                      </Button>
                    </Link>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Simulates return from billing page
                    </Text>
                  </div>
                  
                  <div>
                    <Link to={testUrls.manualSync}>
                      <Button fullWidth>
                        Manual Sync
                      </Button>
                    </Link>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Direct sync without billing trigger
                    </Text>
                  </div>
                </div>
                
                <div style={{ backgroundColor: "#fff3cd", padding: "1rem", borderRadius: "8px" }}>
                  <Text as="h4" variant="headingMd">Expected Behavior:</Text>
                  <ul style={{ paddingLeft: "1.5rem", margin: "0.5rem 0" }}>
                    <li>App index detects billing_completed=1</li>
                    <li>Auto-redirect to /app/sync-subscription</li>
                    <li>Sync queries Shopify API for subscriptions</li>
                    <li>Updates local database with correct plan</li>
                    <li>Redirects to dashboard with success message</li>
                  </ul>
                </div>
              </BlockStack>
            </div>
          </Card>
        </Layout.Section>

        {/* Test des résultats */}
        <Layout.Section>
          <Card>
            <div style={{ padding: "1.5rem" }}>
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">📊 Test Results & Status</Text>
                
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "0.5rem" }}>
                  <div>
                    <Link to={testUrls.dashboardSuccess}>
                      <Button fullWidth tone="success">
                        ✅ Test Success State
                      </Button>
                    </Link>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Dashboard with success banner
                    </Text>
                  </div>
                  
                  <div>
                    <Link to={testUrls.dashboardError}>
                      <Button fullWidth tone="critical">
                        ❌ Test Error State
                      </Button>
                    </Link>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Dashboard with error banner
                    </Text>
                  </div>
                  
                  <div>
                    <Link to={testUrls.status}>
                      <Button fullWidth>
                        🔍 Check System Status
                      </Button>
                    </Link>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Current subscription sync status
                    </Text>
                  </div>
                  
                  <div>
                    <Link to={testUrls.plans}>
                      <Button fullWidth>
                        💳 Plans Page
                      </Button>
                    </Link>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Start real billing flow
                    </Text>
                  </div>
                </div>
              </BlockStack>
            </div>
          </Card>
        </Layout.Section>

        {/* Instructions de test */}
        <Layout.Section>
          <Card>
            <div style={{ padding: "1.5rem" }}>
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">📋 Testing Instructions</Text>
                
                <div style={{ backgroundColor: "#d4edda", padding: "1rem", borderRadius: "8px" }}>
                  <Text as="h4" variant="headingMd">🎯 Real Billing Test:</Text>
                  <ol style={{ paddingLeft: "1.5rem", margin: "0.5rem 0" }}>
                    <li>Go to <strong>Plans Page</strong> above</li>
                    <li>Click <strong>"Get Standard"</strong> or <strong>"Get Professional"</strong></li>
                    <li>Complete payment on Shopify (it's in test mode)</li>
                    <li>Watch for the beautiful success page</li>
                    <li>Dashboard should show new plan with success banner</li>
                    <li>Check <strong>System Status</strong> to verify everything synced</li>
                  </ol>
                </div>
                
                <div style={{ backgroundColor: "#f8d7da", padding: "1rem", borderRadius: "8px" }}>
                  <Text as="h4" variant="headingMd">🔍 Debug Checklist:</Text>
                  <ul style={{ paddingLeft: "1.5rem", margin: "0.5rem 0" }}>
                    <li>✅ Shopify redirects to /billing-return?charge_id=XXXXX</li>
                    <li>✅ Success page shows and redirects automatically</li>
                    <li>✅ App index detects billing_completed parameter</li>
                    <li>✅ Sync runs and updates database</li>
                    <li>✅ Dashboard shows correct plan and success message</li>
                    <li>✅ System status shows "Synchronized"</li>
                  </ul>
                </div>
                
                <div style={{ backgroundColor: "#e2e3e5", padding: "1rem", borderRadius: "8px" }}>
                  <Text as="h4" variant="headingMd">📝 Server Logs to Watch:</Text>
                  <ul style={{ paddingLeft: "1.5rem", margin: "0.5rem 0", fontFamily: "monospace", fontSize: "0.9em" }}>
                    <li>🎉 Billing return with charge_id: XXXXX</li>
                    <li>🏠 App index loaded for SHOP</li>
                    <li>🔄 Billing completed detected, triggering automatic sync</li>
                    <li>🔄 === SYNC SUBSCRIPTION STARTED ===</li>
                    <li>✅ === SYNC COMPLETED SUCCESSFULLY ===</li>
                  </ul>
                </div>
              </BlockStack>
            </div>
          </Card>
        </Layout.Section>

        {/* Navigation */}
        <Layout.Section>
          <ButtonGroup>
            <Link to="/app">
              <Button>← Back to Dashboard</Button>
            </Link>
            <Button onClick={() => window.location.reload()}>
              ↻ Refresh Tests
            </Button>
            <Link to="/app/plans">
              <Button variant="primary">🚀 Start Real Test</Button>
            </Link>
          </ButtonGroup>
        </Layout.Section>
      </Layout>
    </Page>
  );
}