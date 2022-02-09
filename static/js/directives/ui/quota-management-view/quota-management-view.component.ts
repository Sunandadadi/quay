import { Input, Component, Inject } from 'ng-metadata/core';
import * as moment from "moment";


/**
 * A component that displays the view for a namespace for quota management.
 */
@Component({
  selector: 'quotaManagement',
  templateUrl: '/static/js/directives/ui/quota-management-view/quota-management-view.component.html'
})
export class QuotaManagementViewComponent implements ng.IComponentController {

  constructor(@Inject('Config') private Config: any) {
  }

  public $onInit(): void {
    return;
  }

}
