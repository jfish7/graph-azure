import {
  Step,
  IntegrationStepExecutionContext,
  createDirectRelationship,
  RelationshipClass,
  IntegrationConfigLoadError,
  IntegrationError,
} from '@jupiterone/integration-sdk-core';

import { createAzureWebLinker } from '../../../azure';
import { IntegrationStepContext, IntegrationConfig } from '../../../types';
import { getAccountEntity, STEP_AD_ACCOUNT } from '../../active-directory';
import {
  createDiagnosticSettingsEntitiesAndRelationshipsForResource,
  diagnosticSettingsEntitiesForResource,
  getDiagnosticSettingsRelationshipsForResource,
} from '../utils/createDiagnosticSettingsEntitiesAndRelationshipsForResource';
import { J1SubscriptionClient } from './client';
import {
  setDataKeys,
  SetDataTypes,
  entities,
  relationships,
  steps,
} from './constants';
import { createLocationEntity, createSubscriptionEntity } from './converters';

export async function fetchSubscription(
  executionContext: IntegrationStepContext,
): Promise<void> {
  const { instance, logger, jobState } = executionContext;
  const accountEntity = await getAccountEntity(jobState);
  const webLinker = createAzureWebLinker(accountEntity.defaultDomain as string);
  const client = new J1SubscriptionClient(instance.config, logger);

  if (!instance.config.subscriptionId) {
    // This should never happen as getStepStartStates should turn off this step if there is no subscriptionId
    throw new IntegrationConfigLoadError(
      'You need to provide a subscriptionId in order to ingest a subscription',
    );
  }
  const subscription = await client.fetchSubscription(
    instance.config.subscriptionId,
  );
  if (subscription) {
    const subscriptionEntity = createSubscriptionEntity(
      webLinker,
      subscription,
    );
    await jobState.addEntity(subscriptionEntity);
    await createDiagnosticSettingsEntitiesAndRelationshipsForResource(
      executionContext,
      subscriptionEntity,
      entities.SUBSCRIPTION,
    );
  } else {
    throw new IntegrationError({
      message:
        'Unable to find the subscription using the provided "Subscription ID"',
      code: 'MISSING_SUBSCRIPTION',
    });
  }
}

export async function fetchLocations(
  executionContext: IntegrationStepContext,
): Promise<void> {
  const { instance, logger, jobState } = executionContext;
  const accountEntity = await getAccountEntity(jobState);
  const webLinker = createAzureWebLinker(accountEntity.defaultDomain as string);
  const client = new J1SubscriptionClient(instance.config, logger);

  const locationNameMap: SetDataTypes['locationNameMap'] = {};

  await jobState.iterateEntities(
    { _type: entities.SUBSCRIPTION._type },
    async (subscriptionEntity) => {
      await client.iterateLocations(
        subscriptionEntity.subscriptionId as string,
        async (location) => {
          const locationEntity = await jobState.addEntity(
            createLocationEntity(webLinker, location),
          );
          await jobState.addRelationship(
            createDirectRelationship({
              _class: RelationshipClass.USES,
              from: subscriptionEntity,
              to: locationEntity,
            }),
          );
          if (location.name) {
            if (locationNameMap[location.name!] !== undefined) {
              // In order to future-proof this function (considering a world where more than
              // 1 subscription is ingested in an integration), alert the operators if more
              // than one location name exists.
              logger.warn(
                {
                  newLocationId: location.id,
                  currentLocationId: locationNameMap[location.name!]?.id,
                },
                'ERROR: Multiple azure_location entities were encountered with the same `name`. There may be multiple subscriptions ingested, which this function is not equipped to handle.',
              );
            } else {
              locationNameMap[location.name!] = locationEntity;
            }
          } else {
            logger.warn(
              {
                locationId: location.id,
                locationName: location.name,
              },
              'ERROR: Azure location.name property is undefined; cannot add to locationNameMap!',
            );
          }
        },
      );
    },
  );
  await jobState.setData(setDataKeys.locationNameMap, locationNameMap);
}

export const subscriptionSteps: Step<
  IntegrationStepExecutionContext<IntegrationConfig>
>[] = [
  {
    id: steps.SUBSCRIPTION,
    name: 'Subscriptions',
    entities: [entities.SUBSCRIPTION, ...diagnosticSettingsEntitiesForResource],
    relationships: [
      ...getDiagnosticSettingsRelationshipsForResource(entities.SUBSCRIPTION),
    ],
    dependsOn: [STEP_AD_ACCOUNT],
    executionHandler: fetchSubscription,
  },
  {
    id: steps.LOCATIONS,
    name: 'Subscription Locations',
    entities: [entities.LOCATION],
    relationships: [relationships.SUBSCRIPTION_USES_LOCATION],
    dependsOn: [STEP_AD_ACCOUNT, steps.SUBSCRIPTION],
    executionHandler: fetchLocations,
  },
];
