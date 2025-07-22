import { db } from "../db.server";

export interface ErrorLog {
  shop: string;
  errorType: string;
  message: string;
  context?: Record<string, any>;
  timestamp: Date;
}

export async function logError(errorLog: ErrorLog): Promise<void> {
  try {
    console.error(`[${errorLog.errorType}] ${errorLog.message}`, errorLog.context);
    
    // En production, vous pourriez sauvegarder en base ou envoyer à un service de monitoring
    if (process.env.NODE_ENV === "production") {
      // Exemple : envoyer à Sentry, Bugsnag, etc.
    }
  } catch (e) {
    console.error("Erreur lors du logging:", e);
  }
}

export function handleGraphQLErrors(errors: any[], shop: string): string[] {
  const messages: string[] = [];
  
  for (const error of errors) {
    let userMessage = "Une erreur inattendue s'est produite";
    
    // Messages spécifiques selon les erreurs Shopify
    if (error.message.includes("price")) {
      userMessage = "Erreur de prix : vérifiez que les prix sont valides";
    } else if (error.message.includes("access")) {
      userMessage = "Permissions insuffisantes pour cette action";
    } else if (error.message.includes("not found")) {
      userMessage = "Produit ou variante introuvable";
    } else if (error.message.includes("rate")) {
      userMessage = "Trop de requêtes, veuillez patienter";
    }
    
    messages.push(userMessage);
    
    // Logger l'erreur technique
    logError({
      shop,
      errorType: "GRAPHQL_ERROR",
      message: error.message,
      context: { error },
      timestamp: new Date(),
    });
  }
  
  return messages;
}

export function createUserFriendlyError(error: any, context: string): string {
  if (error.message.includes("ENOTFOUND")) {
    return "Problème de connexion réseau";
  }
  
  if (error.message.includes("timeout")) {
    return "La requête a pris trop de temps";
  }
  
  if (error.message.includes("P2002")) {
    return "Cette donnée existe déjà";
  }
  
  if (error.message.includes("P2025")) {
    return "Élément non trouvé";
  }
  
  return `Erreur lors de ${context}`;
}