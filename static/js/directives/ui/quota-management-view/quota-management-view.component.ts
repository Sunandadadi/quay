import { Input, Component, Inject } from 'ng-metadata/core';
import './quota-management-view.component.css';
// import angular = require("angular");


/**
 * A component that displays the view for an organization for quota management.
 */
@Component({
  selector: 'quota-management-view',
  templateUrl: '/static/js/directives/ui/quota-management-view/quota-management-view.component.html'
})
export class QuotaManagementViewComponent {

  @Input('<') public organization: any;
  public prevQuotaConfig: object = {'quota': null, 'limits': []};
  public currentQuotaConfig: object = {'quota': null, 'limits': []};

  private updating: boolean;
  private quotaLimitTypes: any[];
  private limitCounter: number;
  private limitElements: any[];
  private prevquotaEnabled: boolean;
  private nameSpaceResource: any;
  private nameSpaceQuotaLimitsResource: any;

  constructor(@Inject('Config') private Config: any, @Inject('ApiService') private ApiService: any,
               @Inject('Features') private Features: any) {

      this.prevquotaEnabled = false;
      this.updating = false;
      this.limitCounter = 0;
      this.limitElements = [];
      this.quotaLimitTypes = [];

      console.log("this.organization.name", this.organization.name);
      this.loadOrgQuota();
      this.loadQuotaLimits();

      // Check if org config has previously configured quota details
      if (this.organization.quota) {
        // Check if org quota was previously set

        // If org quota is previously set and is more than 0
        if (this.organization.quota["set_quota"] != null) {
          this.prevQuotaConfig['quota'] = this.organization.quota["set_quota"];
          this.currentQuotaConfig['quota'] = this.organization.quota["set_quota"];
          this.prevQuotaConfig['limits'] = [...this.organization.quota["limits"]];
          this.currentQuotaConfig['limits'] = [...this.organization.quota["limits"]];
          this.prevquotaEnabled = true;
        }

        // this.quotaLimitTypes = this.organization.quota["quota_limit_types"];
      }
      console.log("this is", this);
  }

  private loadOrgQuota() {
    this.nameSpaceResource = this.ApiService.getNamespaceQuota(null,
        {'namespace': this.organization.name}).then((resp) => {
        this.prevQuotaConfig['quota'] = resp["limit_bytes"];
        this.currentQuotaConfig['quota'] = resp["limit_bytes"];
        this.quotaLimitTypes = resp["quota_limit_types"];
        if (resp["limit_bytes"] != null) {
          this.prevquotaEnabled = true;
        }
      });
  }

  private loadQuotaLimits() {
    this.nameSpaceQuotaLimitsResource = this.ApiService.getOrganizationQuotaLimit(null,
        {'namespace': this.organization.name}).then((resp) => {
        this.prevQuotaConfig['limits'] = resp['quota_limits'];
        this.currentQuotaConfig['limits'] = resp['quota_limits'];
        if (this.currentQuotaConfig['limits']) {
          for (let i = 0; i < this.currentQuotaConfig['limits'].length; i++) {
            this.populateQuotaLimit(this.currentQuotaConfig['limits'][i]);
          }
        }
      });
  }



  private updateOrganizationQuota(data, params, errorDisplay): void {
    if (!this.prevquotaEnabled || this.prevQuotaConfig['quota'] != this.currentQuotaConfig['quota']) {
      let quotaMethod = this.ApiService.createNamespaceQuota;
      let m1 = "createNamespaceQuota";

      if (this.prevquotaEnabled) {
        quotaMethod = this.ApiService.changeOrganizationQuota;
        m1 = "changeOrganizationQuota";
      }

      console.log("method is", m1);
      quotaMethod(data, params).then((resp) => {
        this.updating = false;
        this.prevQuotaConfig = {...this.currentQuotaConfig};
        this.prevquotaEnabled = true;
      }, errorDisplay);
    }
  }

  private updateQuotaLimits(data, params, errorDisplay): void {
    if (JSON.stringify(this.prevQuotaConfig['limits']) != JSON.stringify(this.currentQuotaConfig['limits'])) {
      return;
    }

    let limitData = this.currentQuotaConfig['limits'];
    let quotaLimitMethod = null;
    let met1 = null;

    if (this.prevQuotaConfig['limits'].length == 0) {
      quotaLimitMethod = this.ApiService.createOrganizationQuotaLimit;
      met1 = "createOrganizationQuotaLimit";
    } else if (JSON.stringify(this.prevQuotaConfig['limits']) != JSON.stringify(this.currentQuotaConfig['limits'])) {
      quotaLimitMethod = this.ApiService.changeOrganizationQuotaLimit;
      met1 = "changeOrganizationQuotaLimit";
    }

    console.log("met1", met1);
    for(var i = 0; i < limitData.length; i++) {
      console.log("limitData", limitData[i]);
      limitData[i]['name'] = limitData[i]['name'];
      quotaLimitMethod(limitData[i], params).then((resp) => {
        this.prevQuotaConfig['limits'][i] = {...limitData[i]};
        this.prevquotaEnabled = true;
      }, errorDisplay);
      this.updating = false;
    }
  }

  private disablesave(): boolean {
     return JSON.stringify(this.prevQuotaConfig) === JSON.stringify(this.currentQuotaConfig);
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
      'limit_bytes': this.currentQuotaConfig['quota'],
    };

    this.updateOrganizationQuota(data, params, errorDisplay);
    this.updateQuotaLimits(data, params, errorDisplay);
  }

  private addQuotaLimit($event): void {
    this.limitCounter++;
    let temp = {'percent_of_limit': '', 'name': this.quotaLimitTypes[0]};
    this.currentQuotaConfig['limits'].push(temp);
    this.limitElements.push([...this.quotaLimitTypes]);
    $event.preventDefault();
  }

  private populateQuotaLimit(data): void {
    this.limitCounter++;
    this.limitElements.push(data);
    console.log("Got data as", data);
    console.log("After populateQuotaLimit", this.limitElements);
    console.log(this.currentQuotaConfig['limits']);
  }

  private removeQuotaLimit(index): void {
    this.limitElements.splice(index, 1);
    this.currentQuotaConfig['limits'].splice(index, 1);
    this.limitCounter--;
  }

}
