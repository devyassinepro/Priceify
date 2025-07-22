export interface Plan {
    name: string;
    displayName: string;
    price: number;
    currency: string;
    usageLimit: number;
    features: string[];
    recommended?: boolean;
    billingInterval?: string;
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
        "20 price modifications per month",
        "4 modification types (%, fixed, +, -)",
        "Basic modification history",
        "Community support"
      ]
    },
    
    standard: {
      name: "standard",
      displayName: "Standard",
      price: 9.99,
      currency: "USD",
      usageLimit: 500,
      billingInterval: "EVERY_30_DAYS",
      features: [
        "500 price modifications per month",
        "All modification types",
        "Complete modification history",
        "Advanced product filters",
        "Email support",
        "CSV export of changes"
      ],
      recommended: true
    },
    
    pro: {
      name: "pro",
      displayName: "Professional",
      price: 19.99,
      currency: "USD",
      usageLimit: 99999,
      billingInterval: "EVERY_30_DAYS",
      features: [
        "Unlimited price modifications",
        "Bulk operations on 1000+ products",
        "Advanced analytics & insights",
        "API access for integrations",
        "Priority support (24h response)",
        "Custom modification rules",
        "White-label reports"
      ]
    }
  };
  
  export function getPlan(planName: string): Plan {
    return PLANS[planName] || PLANS.free;
  }
  
  export function canUseFeature(subscription: any, feature: string): boolean {
    const plan = getPlan(subscription?.planName || 'free');
    
    // Check usage limits first
    if (subscription && subscription.usageCount >= plan.usageLimit) {
      return false;
    }
    
    // Feature-specific checks
    switch (feature) {
      case 'advanced_filters':
        return plan.name !== 'free';
      case 'csv_export':
        return plan.name === 'standard' || plan.name === 'pro';
      case 'bulk_operations':
        return plan.name === 'pro';
      case 'api_access':
        return plan.name === 'pro';
      case 'unlimited_modifications':
        return plan.name === 'pro';
      default:
        return true;
    }
  }
  
  export function formatPriceDisplay(price: number, currency: string = "USD"): string {
    if (price === 0) return "Free";
    
    // Shopify will handle the actual currency conversion
    // This is just for display purposes
    const formatter = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 2,
    });
    
    return `${formatter.format(price)}/month`;
  }