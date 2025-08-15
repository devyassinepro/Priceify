// app/lib/plans.ts - Configuration mise à jour pour le Shopify App Store

export interface Plan {
  name: string;
  displayName: string;
  price: number;
  currency: string;
  usageLimit: number;
  features: string[];
  recommended?: boolean;
  billingInterval?: string;
  trialDays?: number;
}

export const PLANS: Record<string, Plan> = {
  free: {
    name: "free",
    displayName: "Free",
    price: 0,
    currency: "USD",
    usageLimit: 20,
    billingInterval: "EVERY_30_DAYS",
    features: [
      "Modify prices for up to 20 unique products per month",
      "Unlimited price changes per product",
      "4 modification types (%, fixed, +, -)",
      "Basic modification history",
      "Product search and filtering",
      "Community support via email"
    ]
  },
  
  starter: {
    name: "starter",
    displayName: "Starter",
    price: 4.99,
    currency: "USD",
    usageLimit: 100,
    billingInterval: "EVERY_30_DAYS",
    trialDays: 7, // 7 jours d'essai gratuit
    features: [
      "Modify prices for up to 100 unique products per month",
      "Unlimited price changes per product",
      "All modification types and filters",
      "Complete modification history",
      "Advanced product search",
      "Email support (48h response)",
      "Export pricing reports"
    ]
  },
  
  standard: {
    name: "standard",
    displayName: "Standard",
    price: 9.99,
    currency: "USD",
    usageLimit: 500,
    billingInterval: "EVERY_30_DAYS",
    trialDays: 14, // 14 jours d'essai gratuit
    features: [
      "Modify prices for up to 500 unique products per month",
      "Unlimited price changes per product",
      "All modification types and bulk operations",
      "Complete modification history with filters",
      "Advanced product filters and search",
      "CSV export of price changes",
      "Priority email support (24h response)",
      "Detailed usage analytics",
      "Scheduled price updates"
    ],
    recommended: true
  },
  
  pro: {
    name: "pro",
    displayName: "Professional", 
    price: 19.99,
    currency: "USD",
    usageLimit: 99999, // Unlimited
    billingInterval: "EVERY_30_DAYS",
    trialDays: 14,
    features: [
      "Modify prices for unlimited products",
      "Unlimited price changes and bulk operations",
      "Advanced analytics and profit insights", 
      "API access for custom integrations",
      "Priority support (12h response time)",
      "Custom pricing rules and automation",
      "White-label reports and data export",
      "Advanced competitor price tracking",
      "Multi-store management",
      "Custom webhooks and notifications"
    ]
  }
};

// Fonction pour obtenir un plan
export function getPlan(planName: string): Plan {
  return PLANS[planName] || PLANS.free;
}

// Vérifier les permissions de fonctionnalités
export function canUseFeature(subscription: any, feature: string): boolean {
  const plan = getPlan(subscription?.planName || 'free');
  
  // Vérifier les limites de produits
  const uniqueProductsModified = (subscription?.uniqueProductsModified as string[])?.length || 0;
  if (uniqueProductsModified >= plan.usageLimit) {
    return false;
  }
  
  // Vérifications spécifiques aux fonctionnalités
  switch (feature) {
    case 'advanced_filters':
      return plan.name !== 'free';
    case 'csv_export':
      return ['starter', 'standard', 'pro'].includes(plan.name);
    case 'bulk_operations':
      return ['standard', 'pro'].includes(plan.name);
    case 'api_access':
      return plan.name === 'pro';
    case 'unlimited_products':
      return plan.name === 'pro';
    case 'priority_support':
      return plan.name !== 'free';
    case 'analytics':
      return ['standard', 'pro'].includes(plan.name);
    case 'automation':
      return plan.name === 'pro';
    case 'scheduled_updates':
      return ['standard', 'pro'].includes(plan.name);
    case 'multi_store':
      return plan.name === 'pro';
    default:
      return true;
  }
}

// Formater l'affichage des prix
export function formatPriceDisplay(price: number, currency: string = "USD"): string {
  if (price === 0) return "Free";
  
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
  });
  
  return `${formatter.format(price)}/month`;
}

// Obtenir les recommandations d'upgrade
export function getUpgradeRecommendation(subscription: any): {
  shouldUpgrade: boolean;
  reason: string;
  recommendedPlan: string;
} {
  const currentPlan = getPlan(subscription?.planName || 'free');
  const uniqueProductsModified = (subscription?.uniqueProductsModified as string[])?.length || 0;
  const usagePercentage = (uniqueProductsModified / subscription.usageLimit) * 100;

  if (currentPlan.name === 'free' && usagePercentage > 80) {
    return {
      shouldUpgrade: true,
      reason: `You've modified ${uniqueProductsModified} of ${subscription.usageLimit} allowed products this month. Upgrade to modify more products without interruption.`,
      recommendedPlan: 'starter'
    };
  }

  if (currentPlan.name === 'starter' && usagePercentage > 85) {
    return {
      shouldUpgrade: true,
      reason: `You're approaching your limit. Upgrade to Standard for 500 products and advanced features.`,
      recommendedPlan: 'standard'
    };
  }

  if (currentPlan.name === 'standard' && usagePercentage > 90) {
    return {
      shouldUpgrade: true,
      reason: `You're a power user! Upgrade to Pro for unlimited product modifications and advanced features.`,
      recommendedPlan: 'pro'
    };
  }

  return {
    shouldUpgrade: false,
    reason: "Your current plan meets your needs.",
    recommendedPlan: currentPlan.name
  };
}

// Calculer l'impact sur le quota pour les opérations bulk
export function estimateProductUsage(
  currentProductsModified: string[], 
  newProductIds: string[], 
  usageLimit: number
): {
  wouldExceed: boolean;
  newProductsCount: number;
  totalAfter: number;
  remaining: number;
} {
  const newProducts = newProductIds.filter(id => !currentProductsModified.includes(id));
  const totalAfter = currentProductsModified.length + newProducts.length;
  
  return {
    wouldExceed: totalAfter > usageLimit,
    newProductsCount: newProducts.length,
    totalAfter,
    remaining: Math.max(0, usageLimit - totalAfter)
  };
}

// Calculer les économies pour les plans annuels (si vous voulez les ajouter)
export function getAnnualDiscount(plan: Plan): {
  monthlyPrice: number;
  annualPrice: number;
  savings: number;
  savingsPercentage: number;
} {
  const monthlyPrice = plan.price;
  const annualPrice = monthlyPrice * 10; // 2 mois gratuits
  const savings = monthlyPrice * 2;
  const savingsPercentage = (savings / (monthlyPrice * 12)) * 100;
  
  return {
    monthlyPrice,
    annualPrice,
    savings,
    savingsPercentage: Math.round(savingsPercentage)
  };
}

// Vérifier si un plan est éligible pour un essai gratuit
export function isEligibleForTrial(subscription: any, planName: string): boolean {
  const plan = getPlan(planName);
  
  // Pas d'essai pour le plan gratuit
  if (plan.name === 'free') return false;
  
  // Vérifier si l'utilisateur n'a jamais eu d'abonnement payant
  return subscription?.planName === 'free' && subscription?.usageCount < 5;
}

// Obtenir le prix avec essai gratuit
export function getPriceWithTrial(plan: Plan, isEligible: boolean): {
  displayPrice: string;
  trialInfo?: string;
} {
  const basePrice = formatPriceDisplay(plan.price);
  
  if (isEligible && plan.trialDays) {
    return {
      displayPrice: basePrice,
      trialInfo: `${plan.trialDays}-day free trial`
    };
  }
  
  return { displayPrice: basePrice };
}