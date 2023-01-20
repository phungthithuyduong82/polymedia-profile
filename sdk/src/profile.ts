import { BCS, getSuiMoveConfig } from '@mysten/bcs';
import {
    GetObjectDataResponse,
    JsonRpcProvider,
    Network,
    OwnedObjectRef,
    SignableTransaction,
    SuiObject,
    SuiMoveObject,
    TransactionEffects,
} from '@mysten/sui.js';

export const POLYMEDIA_PROFILE_PACKAGE_ID = '0x7ad330b6f772a09744a94b801eea873e102979b8';
export const POLYMEDIA_PROFILE_REGISTRY_ID = '0x1372bff754b692c6cdd31e92685ce3bd233a580f';

// TODO: ProfileCache to only fetch new addresses

const rpc = new JsonRpcProvider(Network.DEVNET);
const bcs = new BCS(getSuiMoveConfig());

type GetObjectsArgs = {
    objectIds: string[];
}
function getObjects({
        objectIds,
    }: GetObjectsArgs): Promise<SuiObject[]>
{
    return rpc.getObjectBatch(
        objectIds
    ).then((objects: GetObjectDataResponse[]) => {
        const profiles: SuiObject[] = [];
        for (const obj of objects)
            if (obj.status == 'Exists')
                profiles.push(obj.details as SuiObject);
        return profiles;
    });
}

export type PolymediaProfile = {
    id: string,
    name: string,
    image: string,
    description: string,
    suiObject: SuiObject,
};
type GetProfileObjectsArgs = {
    objectIds: string[],
}
export function getProfileObjects({
        objectIds,
    }: GetProfileObjectsArgs): Promise<PolymediaProfile[]>
{
    return getObjects({
        objectIds
    })
    .then((objectRefs: SuiObject[]) => {
        const profiles: PolymediaProfile[] = [];
        for (const objRef of objectRefs) {
            const objData = objRef.data as SuiMoveObject;
            profiles.push({
                id: objData.fields.id.id,
                name: objData.fields.name,
                image: objData.fields.image,
                description: objData.fields.description,
                suiObject: objRef,
            });
        }
        return profiles;
    })
    .catch((error: any) => {
        throw error;
    });
}

type FindProfileObjectIdsArgs = {
    lookupAddresses: string[];
    packageId?: string;
    registryId?: string;
}
export function findProfileObjectIds({
        lookupAddresses,
        packageId = POLYMEDIA_PROFILE_PACKAGE_ID,
        registryId = POLYMEDIA_PROFILE_REGISTRY_ID
    }: FindProfileObjectIdsArgs): Promise<Map<string,string>>
{
    lookupAddresses = [...new Set(lookupAddresses)]; // deduplicate
    const moveCall = {
        packageObjectId: packageId,
        module: 'profile',
        function: 'get_profiles',
        typeArguments: [],
        arguments: [
            registryId,
            lookupAddresses,
        ],
    };
    const callerAddress = '0x7777777777777777777777777777777777777777';
    return rpc.devInspectMoveCall(callerAddress, moveCall)
    .then((resp: any) => {
        //                  Sui/Ethos || Suiet
        const effects = (resp.effects || resp.EffectsCert?.effects?.effects) as TransactionEffects;
        if (effects.status.status == 'success') {
            // Deserialize the returned value into an array of addresses
            const returnValue: any[] = resp.results.Ok[0][1].returnValues[0]; // grab the 1st and only tuple
            const valueType: string = returnValue[1];
            const valueData = Uint8Array.from(returnValue[0]);
            const profileAddreses: string[] = bcs.de(valueType, valueData, 'hex');

            // Create a Map where the keys are lookupAddresses and the values are profileAddreses
            const notFoundAddress = '0000000000000000000000000000000000000000';
            const length = lookupAddresses.length; // same as profileAddreses.length
            const result = new Map<string, string>();
            for(let i = 0; i < length; i++) {
                const lookupAddr = lookupAddresses[i];
                const profileAddr = profileAddreses[i];
                if (profileAddr != notFoundAddress) {
                    result.set(lookupAddr, profileAddr);
                }
            }
            return result;
        } else {
            throw new Error(effects.status.error);
        }
    })
    .catch((error: any) => {
        throw error;
    });
}

type WalletArg = {
    signAndExecuteTransaction: (transaction: SignableTransaction) => Promise<any>,
}
type CreateRegistryArgs = {
    wallet: WalletArg,
    registryName: string;
    packageId?: string;
}
export function createRegistry({
        wallet,
        registryName,
        packageId = POLYMEDIA_PROFILE_PACKAGE_ID,
    } : CreateRegistryArgs): Promise<OwnedObjectRef>
{
    return wallet.signAndExecuteTransaction({
        kind: 'moveCall',
        data: {
            packageObjectId: packageId,
            module: 'profile',
            function: 'create_registry',
            typeArguments: [],
            arguments: [
                registryName,
            ],
            gasBudget: 1000,
        }
    })
    .then((resp: any) => {
        //                  Sui/Ethos || Suiet
        const effects = (resp.effects || resp.EffectsCert?.effects?.effects) as TransactionEffects;
        if (effects.status.status == 'success') {
            if (effects.created?.length === 1) {
                return effects.created[0] as OwnedObjectRef;
            } else {
                throw new Error("transaction was successful, but new object is missing. Response: "
                    + JSON.stringify(resp));
            }
        } else {
            throw new Error(effects.status.error);
        }
    })
    .catch((error: any) => {
        throw error;
    });
}

type CreateProfileArgs = {
    wallet: WalletArg,
    name: string,
    image?: string,
    description?: string,
    packageId?: string;
    registryId?: string,
}
export function createProfile({
        wallet,
        name,
        image = '',
        description = '',
        packageId = POLYMEDIA_PROFILE_PACKAGE_ID,
        registryId = POLYMEDIA_PROFILE_REGISTRY_ID
    } : CreateProfileArgs): Promise<OwnedObjectRef[]>
{
    return wallet.signAndExecuteTransaction({
        kind: 'moveCall',
        data: {
            packageObjectId: packageId,
            module: 'profile',
            function: 'create_profile',
            typeArguments: [],
            arguments: [
                registryId,
                name,
                image,
                description,
            ],
            gasBudget: 1000,
        }
    })
    .then((resp: any) => {
        //                  Sui/Ethos || Suiet
        const effects = (resp.effects || resp.EffectsCert?.effects?.effects) as TransactionEffects;
        if (effects.status.status == 'success') {
            if (effects.created?.length === 2) {
                console.debug('[onSubmitCreateProfile] Success:', resp);
                return [ // `sui::dynamic_field::Field` and `polymedia_profile::profile::Profile`
                    effects.created[0] as OwnedObjectRef,
                    effects.created[1] as OwnedObjectRef,
                ];
            } else {
                throw new Error("transaction was successful, but object count is off. Response: "
                    + JSON.stringify(resp));
            }
        } else {
            throw new Error(effects.status.error);
        }
    })
    .catch((error: any) => {
        throw error;
    });
}
