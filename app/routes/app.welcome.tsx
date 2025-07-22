import { json, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, Link } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import {
  Card,
  Layout,
  Page,
  Text,
  Button,
  ButtonGroup,
  Banner,
  List,
  Grid,
  LegacyCard
} from "@shopify/polaris";
import { getOrCreateSubscription } from "../models/subscription.server";
import { PLANS } from "../lib/plans";
import { redirect } from "@remix-run/node";


export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const subscription = await getOrCreateSubscription(session.shop);

  // Redirection côté serveur si pas nouveau
  if (subscription.usageCount > 0) {
    throw redirect("/app");
  }
  
  return json({
    shop: session.shop,
    subscription,
    isNewUser: subscription.usageCount === 0,
  });
};

export default function Welcome() {
  const { shop, subscription, isNewUser } = useLoaderData<typeof loader>();
  
//   if (!isNewUser) {
//     // Rediriger vers l'accueil si pas nouveauwe
//     return <Navigate to="/app" replace />;
//   }

  return (
    <Page title="🎉 Bienvenue sur Dynofy !">
      <Layout>
        <Layout.Section>
          <Banner tone="success" title={`Installation réussie sur ${shop} !`}>
            <Text as="p">
              Votre application est configurée avec le plan gratuit. 
              Vous pouvez commencer à utiliser Dynofy immédiatement !
            </Text>
          </Banner>
        </Layout.Section>

        <Layout.Section>
          <Grid>
          <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 5, xl: 4 }}>
              <Card>
                <div style={{ padding: "2rem" }}>
                  <Text as="h2" variant="headingLg">🚀 Commencez maintenant</Text>
                  
                  <div style={{ margin: "1.5rem 0" }}>
                    <Text as="p">
                      Avec votre plan gratuit, vous pouvez :
                    </Text>
                    <List type="bullet">
                      <List.Item>Modifier 20 produits par mois</List.Item>
                      <List.Item>Utiliser 4 types de modifications (%, €, +, -)</List.Item>
                      <List.Item>Consulter l'historique de base</List.Item>
                      <List.Item>Filtrer vos produits</List.Item>
                    </List>
                  </div>

                  <ButtonGroup>
                    <Link to="/app/pricing">
                      <Button variant="primary" size="large">
                        💰 Commencer à modifier les prix
                      </Button>
                    </Link>
                    <Link to="/app">
                      <Button size="large">
                        📊 Voir le dashboard
                      </Button>
                    </Link>
                  </ButtonGroup>
                </div>
              </Card>
            </Grid.Cell>
            
            <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
              <LegacyCard>
                <div style={{ padding: "1.5rem", textAlign: "center" }}>
                  <Text as="h3" variant="headingMd">Besoin de plus ?</Text>
                  <Text as="p" tone="subdued">
                    Plans Standard et Pro disponibles
                  </Text>
                  
                  <div style={{ margin: "1rem 0" }}>
                    <Text as="p" variant="bodySm">
                      • Jusqu'à 500+ modifications/mois
                    </Text>
                    <Text as="p" variant="bodySm">
                      • Export CSV
                    </Text>
                    <Text as="p" variant="bodySm">
                      • Support prioritaire
                    </Text>
                  </div>
                  
                  <Link to="/app/billing">
                    <Button>Voir les plans</Button>
                  </Link>
                </div>
              </LegacyCard>
            </Grid.Cell>
          </Grid>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <div style={{ padding: "1.5rem" }}>
              <Text as="h3" variant="headingMd">💡 Guide rapide</Text>
              
              <div style={{ marginTop: "1rem", display: "grid", gap: "0.5rem" }}>
                <Text as="p">
                  <strong>1. Filtrez</strong> vos produits par nom ou statut
                </Text>
                <Text as="p">
                  <strong>2. Sélectionnez</strong> les produits à modifier (checkbox)
                </Text>
                <Text as="p">
                  <strong>3. Choisissez</strong> le type (+10%, Prix fixe 19.99€, etc.)
                </Text>
                <Text as="p">
                  <strong>4. Prévisualisez</strong> dans la colonne "Nouveau prix"
                </Text>
                <Text as="p">
                  <strong>5. Cliquez "Appliquer"</strong> pour confirmer les changements
                </Text>
              </div>
            </div>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}