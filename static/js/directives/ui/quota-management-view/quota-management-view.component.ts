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
  private prevquotaEnabled: boolean;
  private nameSpaceResource: any;
  private nameSpaceQuotaLimitsResource: any;
  private rejectLimitType: string = 'Reject';

  constructor(@Inject('Config') private Config: any, @Inject('ApiService') private ApiService: any,
               @Inject('Features') private Features: any) {

      this.prevquotaEnabled = false;
      this.updating = false;
      this.limitCounter = 0;
      this.quotaLimitTypes = [];

      this.loadOrgQuota(true);
      this.loadQuotaLimits(true);
      console.log("this is", this);
  }

  private loadOrgQuota(fresh) {
    this.nameSpaceResource = this.ApiService.getNamespaceQuota(null,
        {'namespace': this.organization.name}).then((resp) => {
        this.prevQuotaConfig['quota'] = resp["limit_bytes"];
        this.currentQuotaConfig['quota'] = resp["limit_bytes"];

        if (fresh) {
          for (let i = 0; i < resp["quota_limit_types"].length; i++) {
            let temp = resp["quota_limit_types"][i];
            temp["quota_limit_id"] = null;
            this.quotaLimitTypes.push(temp);
          }
        }

        if (resp["limit_bytes"] != null) {
          this.prevquotaEnabled = true;
        }
      });
  }

  private loadQuotaLimits(fresh) {
    this.nameSpaceQuotaLimitsResource = this.ApiService.getOrganizationQuotaLimit(null,
        {'namespace': this.organization.name}).then((resp) => {
        this.prevQuotaConfig['limits'] = resp['quota_limits'];
        this.currentQuotaConfig['limits'] = resp['quota_limits'];

        if (fresh) {
          if (this.currentQuotaConfig['limits']) {
            for (let i = 0; i < this.currentQuotaConfig['limits'].length; i++) {
              this.populateQuotaLimit(this.currentQuotaConfig['limits'][i]);
            }
          }
        }

      });
  }

  private updateOrganizationQuota(data, params): void {
    console.log("In updateOrganizationQuota");
    if (!this.prevquotaEnabled || this.prevQuotaConfig['quota'] != this.currentQuotaConfig['quota']) {
      console.log("inside updateOrganizationQuota");
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
      }, this.displayError());
    }
  }

  private createOrgQuotaLimit(data, params): void {
    for (let i = 0; i < data.length; i++) {
      let to_send = {
          'percent_of_limit': data[i]['percent_of_limit'],
          'quota_type_id': data[i]['limit_type']['quota_type_id']
      };
      this.ApiService.createOrganizationQuotaLimit(to_send, params).then((resp) => {
        // this.prevQuotaConfig['limits'].push({...data[i]});
        this.prevquotaEnabled = true;
      }, this.displayError());
    }
  }

  private updateOrgQuotaLimit(data, params): void {
    console.log("In updateOrgQuotaLimit");
    if (!data) {
      return;
    }
    for (let i = 0; i < data.length; i++) {
      console.log("Sending", data[i]);
      let to_send = {
          'percent_of_limit': data[i]['percent_of_limit'],
          'quota_type_id': data[i]['limit_type']['quota_type_id'],
          'quota_limit_id': data[i]['limit_type']['quota_limit_id']
      };
      console.log("Sending to update", data[i]);
      console.log("params", params);
      this.ApiService.changeOrganizationQuotaLimit(to_send, params).then((resp) => {
        // this.prevQuotaConfig['limits'].push({...data});
        this.prevquotaEnabled = true;
      }, this.displayError());
    }
  }

  private deleteOrgQuotaLimit(data, params): void {
    console.log("In deleteOrgQuotaLimit");
    if (!data) {
      return;
    }
    for (let i = 0; i < data.length; i++) {
      params['quota_limit_id'] = data[i]['limit_type']['quota_limit_id'];
      console.log("params isssss", params);
      this.ApiService.deleteOrganizationQuotaLimit(null, params).then((resp) => {
        // this.prevQuotaConfig['limits'].push({...data});
        this.prevquotaEnabled = true;
      }, this.displayError());
    }
  }

  private similarLimits(): boolean {
    return JSON.stringify(this.prevQuotaConfig['limits']) === JSON.stringify(this.currentQuotaConfig['limits']);
  }

  private fetchLimitsToDelete(): object {
    // In prev but not in current => to be deleted
    let currentQuotaConfig = this.currentQuotaConfig['limits'];
    let prevQuotaConfig = this.prevQuotaConfig['limits'];
    return prevQuotaConfig.filter(function(obj1) {
      return !currentQuotaConfig.some(function(obj2) {
        return obj1.percent_of_limit === obj2.percent_of_limit && obj1.limit_type.name === obj2.limit_type.name;
      });
    });
  }

  private fetchLimitsToAdd(): object {
    // In current but not in prev => to add
    let currentQuotaConfig = this.currentQuotaConfig['limits'];
    let prevQuotaConfig = this.prevQuotaConfig['limits'];
    return currentQuotaConfig.filter(function(obj1) {
      return !prevQuotaConfig.some(function(obj2) {
        return obj1.limit_type.name === obj2.limit_type.name && obj1.percent_of_limit === obj2.percent_of_limit;
      });
    });
  }

  private fetchLimitsToUpdate(): object {
    // In current and prev but different values
    let currentQuotaConfig = this.currentQuotaConfig['limits'];
    let prevQuotaConfig = this.prevQuotaConfig['limits'];

    return currentQuotaConfig.filter(function(obj1) {
      return prevQuotaConfig.some(function(obj2) {
        return obj1.limit_type.quota_limit_id == obj2.limit_type.quota_limit_id &&
          (obj1.percent_of_limit != obj2.percent_of_limit || obj1.limit_type.name != obj2.limit_type.name);
      });
    });

  }

  private filterDelFromUpdateItems(deletedItems, updatedItems): object {
    return updatedItems.filter(function(obj1) {
      return !deletedItems.find(function(obj2) {
        return obj1.limit_type.name === obj2.limit_type.name && obj1.percent_of_limit === obj2.percent_of_limit;
      });
    });
  }

  private updateQuotaLimits(data, params): void {
    console.log("In updateQuotaLimits");
    if (this.similarLimits()) {
      console.log("similarLimits");
      return;
    }


    let toDelete = this.fetchLimitsToDelete();
    console.log("toDelete", toDelete);
    let toAdd = this.fetchLimitsToAdd();
    console.log("toAdd", toAdd);

    let toUpdate = this.filterDelFromUpdateItems(toDelete, this.fetchLimitsToUpdate());
    console.log("toUpdate", toUpdate);

    this.createOrgQuotaLimit(toAdd, params);
    this.updateOrgQuotaLimit(toUpdate, params);
    this.deleteOrgQuotaLimit(toDelete, params);
    // this.prevQuotaConfig['limits'] == [...this.currentQuotaConfig['limits']];

  }

  private validLimits(): boolean {
    let valid = true;
    let rejectCount = 0;
    for (let i = 0; i < this.currentQuotaConfig['limits'].length; i++) {

      if (this.currentQuotaConfig['limits'][i]['limit_type']['name'] === this.rejectLimitType) {
        rejectCount++;

        if (rejectCount > 1) {
          let alert = this.displayError('You can only have one Reject type of Quota Limits. Please remove to proceed');
          alert();
          valid = false;
          break;
        }
      }

    }

    return valid;
  }

  private displayError(message = 'Could not update quota details'): any {
    this.updating = true;
    let errorDisplay = this.ApiService.errorDisplay(message, () => {
      this.updating = false;
    });
    return errorDisplay;
  }

  private disableSave(): boolean {
    return this.prevQuotaConfig['quota'] === this.currentQuotaConfig['quota'] && this.similarLimits();
  }

  private updateQuotaDetails(): void {

    // If current state is same as previous do nothing
    if (this.disableSave()) {
      return;
    }

    // Validate correctness
    if (!this.validLimits()) {
      console.log("Not valid!");
      return;
    }
    console.log("Input data is valid!!");

    let params = {
      'namespace': this.organization.name
    };

    let data = {
      'limit_bytes': this.currentQuotaConfig['quota'],
    };

    this.updateOrganizationQuota(data, params);
    this.updateQuotaLimits(data, params);
    this.loadOrgQuota(false);
    this.loadQuotaLimits(false);
    console.log("All done");
    console.log("this.prevQuotaConfig", this.prevQuotaConfig);
    console.log("this.currentQuotaConfig", this.currentQuotaConfig);
  }

  private addQuotaLimit($event): void {
    this.limitCounter++;
    let temp = {'percent_of_limit': '', 'limit_type': this.quotaLimitTypes[0]};
    this.currentQuotaConfig['limits'].push(temp);
    $event.preventDefault();
  }

  private populateQuotaLimit(data): void {
    this.limitCounter++;
  }

  private removeQuotaLimit(index): void {
    this.currentQuotaConfig['limits'].splice(index, 1);
    this.limitCounter--;
  }

}
