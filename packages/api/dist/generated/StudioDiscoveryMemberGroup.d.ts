import type { StudioDiscoveryDesignValue } from "./StudioDiscoveryDesignValue";
import type { StudioDiscoveryRoleBinding } from "./StudioDiscoveryRoleBinding";
export type StudioDiscoveryMemberGroup = {
    memberId: string;
    designValues: Array<StudioDiscoveryDesignValue>;
    bindings: Array<StudioDiscoveryRoleBinding>;
    missingRoles: Array<string>;
    duplicateRoles: Array<string>;
    confidence: number;
};
