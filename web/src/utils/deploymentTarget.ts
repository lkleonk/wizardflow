export type WizardFlowDeploymentTarget = "hosted" | "local";

const rawDeploymentTarget = process.env.NEXT_PUBLIC_WIZARDFLOW_TARGET;

export const wizardFlowDeploymentTarget: WizardFlowDeploymentTarget =
  rawDeploymentTarget === "local" ? "local" : "hosted";

export const isHostedWizardFlow =
  wizardFlowDeploymentTarget === "hosted";
