import { KeyVaultManagementClient } from '@azure/arm-keyvault';
import { Vault } from '@azure/arm-keyvault/esm/models';
import { KeyClient, KeyProperties } from '@azure/keyvault-keys';
import { SecretClient, SecretProperties } from '@azure/keyvault-secrets';
import {
  Client,
  iterateAllResources,
} from '../../../azure/resource-manager/client';
import { resourceGroupName, resourceName } from '../../../azure/utils';

export class KeyVaultClient extends Client {
  public async iterateKeyVaults(
    callback: (
      resource: Vault,
      serviceClient: KeyVaultManagementClient,
    ) => void | Promise<void>,
  ): Promise<void> {
    const serviceClient = await this.getAuthenticatedServiceClient(
      KeyVaultManagementClient,
    );

    await iterateAllResources({
      logger: this.logger,
      serviceClient,
      resourceEndpoint: serviceClient.vaults,
      resourceDescription: 'keyvault.vaults',
      callback: async (vault: Vault, client) => {
        const vaultWithProperties = await client.vaults.get(
          resourceGroupName(vault.id, true),
          resourceName(vault),
        );
        await callback(vaultWithProperties, client);
      },
    });
  }

  public async iterateKeys(
    vaultUri: string,
    callback: (resource: KeyProperties) => void | Promise<void>,
  ): Promise<void> {
    const client = new KeyClient(vaultUri, this.getClientSecretCredentials());
    try {
      for await (const properties of client.listPropertiesOfKeys()) {
        await callback(properties);
      }
    } catch (err) {
      // Idea: we still want fetchKeyVaultKeys step to succeed (the below ones will just get skipped)
      // For those KeyVaults where the permission for listing keys is missing
      // a warn message will be shown indicating that
      if (err.statusCode === 403) {
        this.logger.warn({ err }, err.message);
        this.logger.publishEvent({
          name: 'MISSING_POLICY',
          description: `Missing a Key Vault access policy. A Key Vault access policy determines whether a given security principal can perform different operations on Key Vault secrets, keys and certificates. Please follow the steps outlined here https://go.microsoft.com/fwlink/?linkid=2125287 and assign a "list" key permission in order to fetch these keys for your Key Vault ${vaultUri}.`,
        });
      } else {
        throw err;
      }
    }
  }

  public async iterateSecrets(
    vaultUri: string,
    callback: (resource: SecretProperties) => void | Promise<void>,
  ): Promise<void> {
    const client = new SecretClient(
      vaultUri,
      this.getClientSecretCredentials(),
    );
    try {
      for await (const properties of client.listPropertiesOfSecrets()) {
        await callback(properties);
      }
    } catch (err) {
      // Idea: we still want fetchKeyVaultSecrets step to succeed (the below ones will just get skipped)
      // For those KeyVaults where the permission for listing secrets is missing
      // a warn message will be shown indicating that
      if (err.statusCode === 403) {
        this.logger.warn({ err }, err.message);
        this.logger.publishEvent({
          name: 'MISSING_POLICY',
          description: `Missing a Key Vault access policy. A Key Vault access policy determines whether a given security principal can perform different operations on Key Vault secrets, keys and certificates. Please follow the steps outlined here https://go.microsoft.com/fwlink/?linkid=2125287 and assign a "list" secret permission in order to fetch these secrets for your Key Vault ${vaultUri}.`,
        });
      } else {
        throw err;
      }
    }
  }
}
