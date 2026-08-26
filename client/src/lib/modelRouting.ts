export type RouteModel<TProvider extends string = string> = { providerId: TProvider; modelId: string };

const MANAGED_FASTEST_ORDER = ["claude-haiku-4-5", "gpt-5-mini", "gpt-5-nano"];

export function defaultFastestSelection<TProvider extends string>(models: RouteModel<TProvider>[]): RouteModel<TProvider>[] {
  const managed = MANAGED_FASTEST_ORDER.flatMap(modelId => models.filter(model => model.providerId === "platform" && model.modelId === modelId))[0];
  return managed ? [{ providerId: managed.providerId, modelId: managed.modelId }] : models[0] ? [{ providerId: models[0].providerId, modelId: models[0].modelId }] : [];
}
