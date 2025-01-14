import { UserService } from '@/services/UserService'
import { ActionTree } from 'vuex'
import RootState from '@/store/RootState'
import UserState from './UserState'
import * as types from './mutation-types'
import { hasError, showToast } from '@/utils'
import { translate } from '@/i18n'
import { Settings } from 'luxon'
import { updateInstanceUrl, updateToken, resetConfig, logout } from '@/adapter'
import { useAuthStore } from '@hotwax/dxp-components';
import { getServerPermissionsFromRules, prepareAppPermissions, resetPermissions, setPermissions } from '@/authorization'

const actions: ActionTree<UserState, RootState> = {

  /**
 * Login user and return token
 */
  async login ({ commit, dispatch }, payload) {

    const { token, oms } = payload;
    dispatch("setUserInstanceUrl", oms);
    try {
        if (token) {
          // Getting the permissions list from server
          const permissionId = process.env.VUE_APP_PERMISSION_ID;

          // Prepare permissions list
          const serverPermissionsFromRules = getServerPermissionsFromRules();
          if (permissionId) serverPermissionsFromRules.push(permissionId);

          const serverPermissions = await UserService.getUserPermissions({
            permissionIds: serverPermissionsFromRules
          }, token);
          const appPermissions = prepareAppPermissions(serverPermissions);

          // Checking if the user has permission to access the app
          // If there is no configuration, the permission check is not enabled
          if (permissionId) {
            // As the token is not yet set in the state passing token headers explicitly
            // TODO Abstract this out, how token is handled should be part of the method not the callee
            const hasPermission = appPermissions.some((appPermissionId: any) => appPermissionId === permissionId );
            // If there are any errors or permission check fails do not allow user to login
            if (hasPermission) {
              const permissionError = 'You do not have permission to access the app.';
              showToast(translate(permissionError));
              console.error("error", permissionError);
              return Promise.reject(new Error(permissionError));
            }
          }

          // Getting user profile
          const userProfile = await UserService.getUserProfile(token);
          userProfile.stores = await UserService.getEComStores(token, userProfile.partyId);
          
          // Getting user preferred store
          let preferredStore = userProfile.stores[0];
          const preferredStoreId =  await UserService.getPreferredStore(token);
          if (preferredStoreId) {
            const store = userProfile.stores.find((store: any) => store.productStoreId === preferredStoreId);
            store && (preferredStore = store)
          }

          setPermissions(appPermissions);
          if (userProfile.userTimeZone) {
            Settings.defaultZone = userProfile.userTimeZone;
          }

          // TODO user single mutation
          commit(types.USER_CURRENT_ECOM_STORE_UPDATED,  preferredStore);
          commit(types.USER_INFO_UPDATED, userProfile);
          commit(types.USER_TOKEN_CHANGED, { newToken: token });
          commit(types.USER_PERMISSIONS_UPDATED, appPermissions);
          updateToken(token);
        }
    } catch (err: any) {
      showToast(translate('Something went wrong'));
      console.error("error", err);
      return Promise.reject(new Error(err))
    }
  },

  /**
   * Logout user
   */
  async logout ({ commit }, payload) {
    // Calling the logout api to flag the user as logged out, only when user is authorised
    // if the user is already unauthorised then not calling the logout api as it returns 401 again that results in a loop, thus there is no need to call logout api if the user is unauthorised
    if(!payload?.isUserUnauthorised) {
      await logout();
    }

    const authStore = useAuthStore()

    // TODO add any other tasks if need
    commit(types.USER_END_SESSION)
    resetConfig();
    this.dispatch("product/resetProductList")
    this.dispatch("product/resetCatalogProducts")
    this.dispatch("order/resetOrderQuery")
    this.dispatch("job/clearCtgryAndBrkrngJobs")
    this.dispatch("util/clearInvConfigs")
    resetPermissions();

    // reset plugin state on logout
    authStore.$reset()
  },

  /**
   * Update user timeZone
   */
     async setUserTimeZone ( { state, commit }, payload) {
      const resp = await UserService.setUserTimeZone(payload)
      if (resp.status === 200 && !hasError(resp)) {
        const current: any = state.current;
        current.userTimeZone = payload.timeZoneId;
        commit(types.USER_INFO_UPDATED, current);
        Settings.defaultZone = current.userTimeZone;
        showToast(translate("Time zone updated successfully"));
      }
    },

  /**
   * Set user's selected Ecom store
   */
    async setEcomStore({ commit }, payload) {
      commit(types.USER_CURRENT_ECOM_STORE_UPDATED, payload.eComStore);
      // Reset all the current queries
      this.dispatch("product/resetProductList")
      this.dispatch("order/resetOrderQuery")
      await UserService.setUserPreference({
        'userPrefTypeId': 'SELECTED_BRAND',
        'userPrefValue': payload.eComStore.productStoreId
      });
    },

  /**
   * Set User Instance Url
   */
    setUserInstanceUrl ({ commit }, payload){
      commit(types.USER_INSTANCE_URL_UPDATED, payload)
      updateInstanceUrl(payload)
    },
}
export default actions;