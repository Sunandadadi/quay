import { Component, Inject } from "ng-metadata/core";
import * as moment from "moment";

/**
 * A component that displays settings for a namespace for proxy cache.
 */

@Component({
  selector: 'proxyCacheSettings',
  templateUrl: '/static/js/directives/ui/proxy-cache-settings/proxy-cache-settings.component.html'
})

export class ProxyCacheSettingsComponent implements ng.IComponentController {

  constructor(@Inject('Config') private Config: any) {
  }

  public $onInit(): void {
    return;
  }
}
