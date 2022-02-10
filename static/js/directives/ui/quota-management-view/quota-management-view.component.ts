import { Input, Component, Inject } from 'ng-metadata/core';
import * as moment from "moment";


/**
 * A component that displays the view for an organization for quota management.
 */
@Component({
  selector: 'quota-management-view',
  templateUrl: '/static/js/directives/ui/quota-management-view/quota-management-view.component.html'
})
export class QuotaManagementViewComponent {

  @Input('<') public organization: any;

  private quotaEnabled: boolean;
  private prevquotaEnabled: boolean;
  private updating: boolean;
  private newQuota: number;
  private quotaLimitTypes: object;
  private setQuota: number;

  constructor(@Inject('Config') private Config: any, @Inject('ApiService') private ApiService: any,
               @Inject('Features') private Features: any) {

      this.quotaEnabled = false;
      this.updating = false;
      this.newQuota = 0;
      this.prevquotaEnabled = false;

      // Check if org config has previously configured quota details
      if (this.organization.quota) {
        // Check if org quota was previously set
        this.setQuota = this.organization.quota["set_quota"];

        // If org quota is previously set and is more than 0
        if (this.setQuota != null) {
          this.newQuota = this.setQuota;
          this.prevquotaEnabled = this.quotaEnabled = true;
        }

        this.quotaLimitTypes = this.organization.quota["quota_limit_types"];
      }
  }

  public $onInit(): void {
    return;
  }

  private disablesave(): boolean {
    return this.prevquotaEnabled == this.quotaEnabled && this.newQuota == this.setQuota;
  }

    private updateQuotaDetails(): void {
    // If current state is same as previous do nothing
    if (this.disablesave()) {
      return;
    }

    this.updating = true;
    let errorDisplay = this.ApiService.errorDisplay('Could not update quota details', () => {
      this.updating = false;
    });

    let params = {
      'namespace': this.organization.name
    };

    let data = {
      'limit_bytes': this.newQuota,
    };

    if (this.prevquotaEnabled && this.quotaEnabled == false) {
      this.ApiService.deleteOrganizationQuota(null, params).then((resp) => {
      this.updating = false;
      }, errorDisplay);
      return;
    }

    let method = this.ApiService.createNamespaceQuota;
    if (this.prevquotaEnabled && this.newQuota != this.setQuota) {
      method = this.ApiService.changeOrganizationQuota;
    }

    method(data, params).then((resp) => {
      this.updating = false;
      this.newQuota = this.newQuota;
    }, errorDisplay);
  }

}
